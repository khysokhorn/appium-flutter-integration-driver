import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler/scheduler.js';

test('retries a job interrupted by a previous process', async () => {
  const state = { jobs: [{ id: 'job-1', deviceId: 'android:serial', actions: [], runAt: new Date(0).toISOString(), status: 'running', repeatEveryMs: null }] };
  const calls = [];
  const store = { read: async () => state, write: async () => {} };
  const runner = { run: async deviceId => calls.push(deviceId) };
  const scheduler = new Scheduler({ store, actionRunner: runner });
  await scheduler.start();
  try {
    assert.equal(scheduler.list()[0].status, 'pending');
    await scheduler.tick();
    assert.deepEqual(calls, ['android:serial']);
    assert.equal(scheduler.list()[0].status, 'done');
  } finally {
    await scheduler.stop();
  }
});
