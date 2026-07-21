// ── Consent (§6.5 / NFR5 Ley 25.326) ───────────────────────────────────────
// Auditable consent per recipient, with timestamp + IP. NO consent → NO send.
// Covers deletion/rectification on request (revoke sets revoked_at).

/** Recipients of a tenant that currently have valid WhatsApp consent (≤5 enforced by caller). */
export async function consentedRecipients(client, tenantId) {
  const { rows } = await client.query(
    `SELECT r.id, r.name, r.phone_e164
       FROM recipient r
      WHERE r.tenant_id = $1
        AND EXISTS (SELECT 1 FROM consent c
                    WHERE c.recipient_id = r.id AND c.channel='whatsapp'
                      AND c.granted = true AND c.revoked_at IS NULL)
      ORDER BY r.created_at`,
    [tenantId]);
  return rows;
}

export async function hasConsent(client, recipientId) {
  const { rows } = await client.query(
    `SELECT 1 FROM consent WHERE recipient_id=$1 AND channel='whatsapp'
       AND granted=true AND revoked_at IS NULL LIMIT 1`, [recipientId]);
  return rows.length > 0;
}

export async function recordConsent(client, { tenantId, recipientId, ip, policyVersion }) {
  const { rows } = await client.query(
    `INSERT INTO consent (tenant_id, recipient_id, channel, granted, granted_at, granted_ip, policy_version)
     VALUES ($1,$2,'whatsapp', true, now(), $3, $4)
     RETURNING id, granted_at`,
    [tenantId, recipientId, ip || null, policyVersion || 'famacon-privacy-v1']);
  return rows[0];
}

export async function revokeConsent(client, recipientId) {
  const { rowCount } = await client.query(
    `UPDATE consent SET revoked_at=now()
     WHERE recipient_id=$1 AND channel='whatsapp' AND revoked_at IS NULL`, [recipientId]);
  return rowCount;
}
