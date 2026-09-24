import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbDevices, parseXctraceDevices } from '../src/farmbridge.mjs';

test('parseAdbDevices parses model and state', () => {
  const input = 'List of devices attached\nemulator-5554 device product:sdk model:Pixel_9 device:emu transport_id:1\nABC unauthorized usb:1-1 transport_id:2\n';
  const devices = parseAdbDevices(input);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].id, 'android:emulator-5554');
  assert.equal(devices[0].name, 'Pixel 9');
  assert.equal(devices[1].state, 'unauthorized');
});

test('parseXctraceDevices parses physical and simulator devices', () => {
  const input = '== Devices ==\nTest iPhone (18.0) (00008110-001234567890001E)\niPhone 16 Pro (18.0) (12345678-1234-1234-1234-123456789ABC) (Simulator)\n';
  const devices = parseXctraceDevices(input);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].kind, 'physical');
  assert.equal(devices[1].kind, 'simulator');
});
