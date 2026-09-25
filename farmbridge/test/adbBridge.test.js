import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbDevices } from '../src/drivers/android/adbBridge.js';

test('parseAdbDevices parses connected devices', () => {
  const result = parseAdbDevices(`List of devices attached\nemulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\nABC123 unauthorized usb:1-1 transport_id:2\n`);
  assert.equal(result.length, 2);
  assert.equal(result[0].serial, 'emulator-5554');
  assert.equal(result[0].model, 'sdk gphone64 arm64');
  assert.equal(result[1].state, 'unauthorized');
});
