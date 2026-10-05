import mqtt from 'mqtt';
import { config } from '../config/index.js';
import { ingestMessage } from './ingestService.js';
import { routingRefFromTopic } from './topics.js';

// MQTT ingestion (§6.1). Two topic shapes are supported (see config.mqtt.topics):
//   famacon/<gatewayRef>/up                        → gatewayRef = topic segment 1
//   application/<appId>/device/<devEui>/event/up   → ChirpStack; gatewayRef = appId
// The routing (gatewayRef) is taken from the topic envelope (see topics.js), so the
// decoder only has to understand the payload body.
export function startMqtt(logger) {
  if (!config.mqtt.url) {
    logger.warn('MQTT disabled (no MQTT_URL)');
    return null;
  }
  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.user,
    password: config.mqtt.password,
    reconnectPeriod: 5000,
    clientId: `famacon-server-${process.pid}`,
  });

  client.on('connect', () => {
    client.subscribe(config.mqtt.topics, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, 'MQTT subscribe failed');
      else logger.info({ topics: config.mqtt.topics }, 'MQTT subscribed');
    });
  });

  client.on('message', async (topic, message) => {
    const gatewayRef = routingRefFromTopic(topic);
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      logger.error({ topic }, 'MQTT: non-JSON payload');
      return;
    }
    try {
      const result = await ingestMessage({ transport: 'mqtt', gatewayRef, payload, log: logger });
      if (result.status === 'rejected') logger.warn({ topic, result }, 'MQTT ingest rejected');
    } catch (err) {
      logger.error({ err: err.message, topic }, 'MQTT ingest error');
    }
  });

  client.on('error', (err) => logger.error({ err: err.message }, 'MQTT error'));
  return client;
}
