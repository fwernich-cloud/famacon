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

// Authentication is by SESSION COOKIE only. We deliberately do NOT accept HTTP
// Basic auth: browsers cache Basic credentials for the session and would silently
// re-authenticate after logout, making "Salir" useless. Programmatic callers log
// in via POST /api/login and reuse the returned cookie.
export function authUser(req) {
  return verifySession(req.cookies?.[SESSION_COOKIE]) || null;
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
