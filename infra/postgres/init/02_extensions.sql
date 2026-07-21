-- TimescaleDB: time-series-ready storage from day 1 (§4b.2 / NFR3).
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
