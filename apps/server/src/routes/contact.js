import { pool } from '../db/pool.js';

// Public contact form endpoint. Stores inbound leads. Honeypot field 'website'
// must stay empty (basic bot filter).
export default async function contactRoutes(fastify) {
  fastify.post('/api/contact', {
    schema: {
      body: {
        type: 'object', required: ['name', 'message'],
        properties: {
          name: { type: 'string', maxLength: 200 },
          email: { type: 'string', maxLength: 200 },
          phone: { type: 'string', maxLength: 60 },
          audience: { type: 'string', maxLength: 40 },
          message: { type: 'string', maxLength: 4000 },
          website: { type: 'string' }, // honeypot
        },
      },
    },
  }, async (req, reply) => {
    if (req.body.website) return reply.code(200).send({ ok: true }); // silently drop bots
    await pool.query(
      `INSERT INTO contact_message (name, email, phone, audience, message, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.body.name, req.body.email || null, req.body.phone || null,
       req.body.audience || null, req.body.message, req.ip]);
    req.log.info({ audience: req.body.audience }, 'contact message received');
    return { ok: true };
  });
}
