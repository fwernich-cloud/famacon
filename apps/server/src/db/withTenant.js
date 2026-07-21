import { pool } from './pool.js';

/**
 * Run `fn` inside a transaction whose connection is pinned to one tenant.
 * We set app.tenant_id with set_config(..., true) = LOCAL to the transaction,
 * so RLS scopes every statement and the setting cannot leak to the next borrower
 * of the pooled connection.
 *
 * @param {string} tenantId  uuid of the tenant (from resolve_gateway)
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // LOCAL to the tx — reset automatically at COMMIT/ROLLBACK.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolve a gateway's routing info WITHOUT a tenant context (the one sanctioned
 * cross-tenant lookup, via a SECURITY DEFINER function). Returns null if unknown.
 */
export async function resolveGateway(gatewayRef) {
  const { rows } = await pool.query(
    'SELECT gateway_id, tenant_id, field_id, hardware_profile FROM resolve_gateway($1)',
    [gatewayRef]
  );
  return rows[0] || null;
}
