import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { verifySession, SESSION_COOKIE } from './session.js';

function safeEq(a, b) {
  const ba = Buffer.from(a || ''), bb = Buffer.from(b || '');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function checkCredentials(user, password) {
  return safeEq(user, config.dashboard.user) && safeEq(password, config.dashboard.password);
}

// A request is authenticated if it carries a valid session cookie OR valid Basic
// auth (kept so curl / programmatic callers still work). Returns the user or null.
export function authUser(req) {
  const fromCookie = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (fromCookie) return fromCookie;
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
  if (m) {
    const [user, pass] = Buffer.from(m[1], 'base64').toString().split(':');
    if (checkCredentials(user, pass)) return user;
  }
  return null;
}

// For /api and admin endpoints: 401 when unauthenticated.
export function requireApi(req, reply, done) {
  if (authUser(req)) return done();
  reply.code(401).send({ error: 'unauthorized' });
}

// For browser pages: redirect to the sign-in page when unauthenticated.
export function requirePage(req, reply, done) {
  if (authUser(req)) return done();
  reply.redirect('/login.html');
}
