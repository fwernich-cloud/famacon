import crypto from 'node:crypto';

// Signed, expiring session token (HMAC-SHA256 with APP_SECRET). No DB needed:
// the cookie is self-contained and tamper-proof. 7-day lifetime (Hito 4 #6): the real use
// is checking from a phone, at night, on bad signal, right after an alert — re-logging in at
// that moment is friction that doesn't belong, so the session lasts about a week.
const SECRET = process.env.APP_SECRET || 'dev-secret-change-me';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signSession(user) {
  const payload = `${user}|${Date.now() + TTL_MS}`;
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch { return null; }
  const [user, exp] = Buffer.from(b64, 'base64url').toString().split('|');
  if (!exp || Date.now() > Number(exp)) return null;
  return user;
}

export const SESSION_COOKIE = 'famacon_session';
export const SESSION_MAXAGE = TTL_MS / 1000;
