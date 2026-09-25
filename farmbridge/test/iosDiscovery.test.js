import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXctraceDevices } from '../src/drivers/ios/iosDiscovery.js';

test('parseXctraceDevices extracts simulator and physical device ids', () => {
  const text = `== Devices ==\nSokhorn's iPhone (18.0) (00008110-001234567890001E)\niPhone 16 Pro (18.0) (12345678-1234-1234-1234-123456789ABC) (Simulator)\n`;
  const devices = parseXctraceDevices(text);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].kind, 'physical');
  assert.equal(devices[1].kind, 'simulator');
});
