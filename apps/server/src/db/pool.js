import pg from 'pg';
import { config } from '../config/index.js';

// Single shared pool. The app connects as the least-privilege `famacon_app`
// role — RLS is enforced on every query (§3.2 / NFR1).
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idle_timeout: 30_000,
});

pool.on('error', (err) => {
  // A pooled idle client error shouldn't crash the process.
  console.error('[pg] idle client error', err);
});

export async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
