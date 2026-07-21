// Central config, read from environment (12-factor). No secrets in code.
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '3000', 10),
  tz: process.env.TZ || 'UTC',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  mqtt: {
    url: process.env.MQTT_URL,
    user: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    // Uplink topic pattern: famacon/<gatewayRef>/up
    topic: 'famacon/+/up',
  },
  dashboard: {
    user: process.env.DASHBOARD_USER,
    password: process.env.DASHBOARD_PASSWORD,
  },
  weatherApiBase: process.env.WEATHER_API_BASE || 'https://api.open-meteo.com/v1',
  publicDomain: process.env.PUBLIC_DOMAIN,
};

export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
}
