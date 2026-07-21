import mqtt from 'mqtt';
import { config } from '../config/index.js';
import { ingestMessage } from './ingestService.js';

// MQTT ingestion (§6.1). The field gateway publishes to famacon/<gatewayRef>/up.
// The gateway ref is taken from the topic (transport envelope), so the decoder
// only has to understand the payload body, not the routing.
export function startMqtt(logger) {
  if (!config.mqtt.url) {
    logger.warn('MQTT disabled (no MQTT_URL)');
    return null;
  }
  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.user,
    password: config.mqtt.password,
    reconnectPeriod: 5000,
    clientId: `famacon-server-${process.pid}`,
  });

  client.on('connect', () => {
    client.subscribe(config.mqtt.topic, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, 'MQTT subscribe failed');
      else logger.info({ topic: config.mqtt.topic }, 'MQTT subscribed');
    });
  });

  client.on('message', async (topic, message) => {
    const parts = topic.split('/'); // famacon / <gatewayRef> / up
    const gatewayRef = parts[1];
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      logger.error({ topic }, 'MQTT: non-JSON payload');
      return;
    }
    try {
      const result = await ingestMessage({ transport: 'mqtt', gatewayRef, payload, log: logger });
      if (result.status === 'rejected') logger.warn({ topic, result }, 'MQTT ingest rejected');
    } catch (err) {
      logger.error({ err: err.message, topic }, 'MQTT ingest error');
    }
  });

  client.on('error', (err) => logger.error({ err: err.message }, 'MQTT error'));
  return client;
}
