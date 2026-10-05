# Famacon Control — Entrega y handoff

Documento único que resume qué se entrega, cómo está montado, qué es de Famacon, cómo se
opera y cómo se verifica. Los detalles están en los documentos enlazados.

## 1. Qué es
Sistema de monitoreo remoto para campos ganaderos: recibe datos de los sensores del campo,
diagnostica en tiempo real (molino/bomba/tanque), y avisa por WhatsApp **solo cuando hace falta**
—evitando falsas alarmas—. La base para detectar el desgaste del cuero del molino (rendimiento)
ya está medida.

## 2. Estado por hito
| Hito | Contenido | Estado |
|------|-----------|--------|
| **M1** | Ingesta (MQTT/HTTP) + decoder enchufable + multi-tenant (RLS) | Entregado y cobrado |
| **M2** | Motor: diagnóstico cruzado + reglas N1/N2 + watchdog | Entregado y cobrado |
| **M3** | Avisos por WhatsApp (API oficial) + consentimiento auditable | Construido; **activación pendiente** (sesión Meta/AnyDesk) |
| **M4** | Tablero interno (solo lectura) + admin de datos de producto | Listo para entrega |
| **M5** | Respaldos + documentación + cesión + handoff | En cierre |

## 3. Cómo está montado
Docker Compose sobre el VPS: **PostgreSQL + TimescaleDB**, **Redis** (colas), **Mosquitto**
(MQTT), servidor **Node/Fastify**, y **nginx + TLS**. Aislamiento por productor a nivel de base
(Row-Level Security). Detalle: [`ARCHITECTURE.md`](ARCHITECTURE.md).
- VPS: `157.230.211.99` · Dominio: `famaconcontrol.com`

## 4. Accesos y titularidad (todo a nombre de Famacon)
Servidor (DigitalOcean), repositorio (GitHub), dominio (Namecheap), DNS/TLS (Cloudflare) y la
cuenta de WhatsApp (Meta) son de Famacon. El desarrollador trabaja como colaborador con acceso
**revocable**; al cierre se rotan las credenciales y se revoca su acceso. La revisión de accesos
(quién accede a qué) se completa en el cierre con Federico.
Cesión: [`CESION_Y_CONFIDENCIALIDAD.md`](CESION_Y_CONFIDENCIALIDAD.md).

## 5. Cómo se opera
Tablero interno de Famacon: `https://famaconcontrol.com/dashboard.html` (login por sesión).
- **Tablero** (solo lectura): estado de equipos, nivel de tanques, alertas, rendimiento, señal/batería, registro de WhatsApp.
- **Administración**: datos de producto de Famacon (cilindros, carrera, geometría de tanques, η) y destinatarios de avisos con su consentimiento. Guía: [`RUNBOOK.md`](RUNBOOK.md).

## 6. WhatsApp (activación)
Corre en **dry-run** hasta cargar las credenciales de Meta; se activa sin tocar código.
Setup de la cuenta, webhook y textos de las plantillas: [`WHATSAPP.md`](WHATSAPP.md).
Prueba de activación: `SMOKE_TO='+549…' bash scripts/go-live-smoketest.sh` (manda un aviso real y
confirma la entrega).

## 7. Cómo verificar que todo anda
- Suite completa contra la pila real: `docker compose up -d && bash test/e2e/run-all.sh` (ver [`../test/e2e/README.md`](../test/e2e/README.md)).
- Tests unitarios del motor: `cd apps/server && npm test`.

## 8. Respaldos
Respaldo diario automático (cron) con **restauración probada**: `scripts/backup.sh`,
`scripts/restore-test.sh`.

## 9. Índice de documentación
- Arquitectura: `docs/ARCHITECTURE.md`
- Operación (runbook): `docs/RUNBOOK.md`
- WhatsApp (setup técnico): `docs/WHATSAPP.md`
- Cesión y confidencialidad: `docs/CESION_Y_CONFIDENCIALIDAD.md`
- Suite E2E: `test/e2e/README.md`
