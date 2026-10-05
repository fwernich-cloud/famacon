import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routingRefFromTopic } from '../src/ingestion/topics.js';

test('famacon topic → gatewayRef is segment 1', () => {
  assert.equal(routingRefFromTopic('famacon/gw_esp_test/up'), 'gw_esp_test');
});
test('ChirpStack topic → gatewayRef is the applicationId', () => {
  assert.equal(routingRefFromTopic('application/app-pilot/device/24e124710c000001/event/up'), 'app-pilot');
});
