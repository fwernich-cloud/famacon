import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { evaluateField } from './evaluate.js';
import { runWatchdog } from '../watchdog/index.js';

// BullMQ needs a connection with maxRetriesPerRequest = null.
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const evaluationQueue = new Queue('evaluation', { connection });
export const watchdogQueue = new Queue('watchdog', { connection });

/** Enqueue a field evaluation after new data lands (called from ingestion). */
export async function enqueueEvaluation(tenantId, fieldId) {
  await evaluationQueue.add('eval', { tenantId, fieldId },
    { removeOnComplete: 500, removeOnFail: 200, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}

let onAlerts = null;
/** M3 hook: register a callback invoked with newly-opened alerts for dispatch. */
export function onAlertsOpened(cb) { onAlerts = cb; }

export function startWorkers(log) {
  const evalWorker = new Worker('evaluation', async (job) => {
    const { tenantId, fieldId } = job.data;
    const result = await evaluateField({ tenantId, fieldId, log });
    if (result.opened.length && onAlerts) {
      try { await onAlerts({ tenantId, fieldId, opened: result.opened }); }
      catch (err) { log?.error({ err: err.message }, 'alert dispatch hook failed'); }
    }
    return { opened: result.opened.length, resolved: result.resolved.length };
  }, { connection, concurrency: 4 });

  const wdWorker = new Worker('watchdog', async () => {
    const r = await runWatchdog(log, async ({ tenantId, fieldId, opened }) => {
      if (opened.length && onAlerts) {
        try { await onAlerts({ tenantId, fieldId, opened }); }
        catch (err) { log?.error({ err: err.message }, 'watchdog dispatch hook failed'); }
      }
    });
    return r;
  }, { connection, concurrency: 1 });

  for (const w of [evalWorker, wdWorker]) {
    w.on('failed', (job, err) => log?.error({ jobId: job?.id, err: err?.message }, 'worker job failed'));
  }

  // Schedule the watchdog to scan every 60s (repeatable).
  watchdogQueue.add('scan', {}, {
    repeat: { every: 60_000 }, jobId: 'watchdog-scan',
    removeOnComplete: true, removeOnFail: true,
  }).then(() => log?.info('watchdog scheduled (60s)'))
    .catch((err) => log?.error({ err: err.message }, 'watchdog schedule failed'));

  return { evalWorker, wdWorker, connection };
}
