import { checkCredentials } from '../lib/auth.js';
import { signSession, SESSION_COOKIE, SESSION_MAXAGE } from '../lib/session.js';

// Sign-in / sign-out. Public routes (no auth guard).
export default async function authRoutes(fastify) {
  fastify.post('/api/login', {
    schema: { body: { type: 'object', required: ['user', 'password'],
      properties: { user: { type: 'string' }, password: { type: 'string' } } } },
  }, async (req, reply) => {
    if (!checkCredentials(req.body.user, req.body.password)) {
      return reply.code(401).send({ ok: false, error: 'Usuario o clave incorrectos.' });
    }
    reply.setCookie(SESSION_COOKIE, signSession(req.body.user), {
      path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: SESSION_MAXAGE,
    });
    return { ok: true };
  });

  fastify.post('/api/logout', async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  fastify.get('/logout', (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.redirect('/login.html');
  });
}
