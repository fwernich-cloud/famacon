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
    // Uplink topics:
    //   famacon/<gatewayRef>/up                         → demo / simple HTTP-style gateways
    //   application/<appId>/device/<devEui>/event/up    → ChirpStack (Milesight SG50, §13)
    // For ChirpStack, the gateway's ext_ref = the ChirpStack applicationId.
    topics: (process.env.MQTT_TOPICS || 'famacon/+/up,application/+/device/+/event/up')
      .split(',').map((t) => t.trim()).filter(Boolean),
  },
  dashboard: {
    user: process.env.DASHBOARD_USER,
    password: process.env.DASHBOARD_PASSWORD,
  },
  weatherApiBase: process.env.WEATHER_API_BASE || 'https://api.open-meteo.com/v1',
  publicDomain: process.env.PUBLIC_DOMAIN,
  notify: {
    // Tenants that must NEVER dispatch WhatsApp. The Demo tenant carries synthetic,
    // permanently-stale alerts and no consented recipients, so without this it logged a
    // skipped_no_consent burst on every 60s sweep, forever. Env-overridable.
    disabledTenants: (process.env.NOTIFY_DISABLED_TENANTS || '00000000-0000-0000-0000-00000000da00')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
}
