import crypto from 'node:crypto';
import { config } from '../config/index.js';

// Minimal HTTP Basic auth for Famacon-only endpoints (dashboard + admin).
// Credentials from env (DASHBOARD_USER/PASSWORD). Constant-time compare.
function safeEq(a, b) {
  const ba = Buffer.from(a || ''), bb = Buffer.from(b || '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function basicAuth(req, reply, done) {
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Basic (.+)$/);
  if (m) {
    const [user, pass] = Buffer.from(m[1], 'base64').toString().split(':');
    if (safeEq(user, config.dashboard.user) && safeEq(pass, config.dashboard.password)) {
      return done();
    }
  }
  reply.header('WWW-Authenticate', 'Basic realm="Famacon"').code(401).send({ error: 'unauthorized' });
}
