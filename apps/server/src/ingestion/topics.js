// Pure MQTT topic routing (no deps, so it's unit-testable in isolation).
// The gatewayRef routes an uplink to a gateway row; it comes from the topic envelope.
//   famacon/<gatewayRef>/up                        → segment 1
//   application/<appId>/device/<devEui>/event/up   → ChirpStack; the applicationId
export function routingRefFromTopic(topic) {
  const parts = String(topic || '').split('/');
  if (parts[0] === 'application' && parts[parts.length - 1] === 'up') return parts[1];
  return parts[1];
}
