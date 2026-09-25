import crypto from 'node:crypto';

const MIN_REPEAT_MS = 60_000;

export class Scheduler {
  constructor({ store, actionRunner }) {
    this.store = store;
    this.actionRunner = actionRunner;
    this.state = { jobs: [] };
    this.timer = null;
    this.running = new Set();
  }

  async start() {
    this.state = await this.store.read();
    this.state.jobs ||= [];
    // An interrupted process leaves in-flight jobs marked running. Make them
    // available again after restart instead of leaving them stuck forever.
    for (const job of this.state.jobs) {
      if (job.status === 'running') job.status = 'pending';
    }
    await this.store.write(this.state);
    this.timer = setInterval(() => this.tick().catch(console.error), 1000);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list() {
    return this.state.jobs;
  }

  async add({ deviceId, actions, runAt, repeatEveryMs = null }) {
    if (!deviceId || !Array.isArray(actions)) throw new Error('deviceId and actions are required');
    const due = new Date(runAt || Date.now());
    if (Number.isNaN(due.getTime())) throw new Error('Invalid runAt');
    if (repeatEveryMs != null && (!Number.isFinite(Number(repeatEveryMs)) || Number(repeatEveryMs) < MIN_REPEAT_MS)) {
      throw new Error(`repeatEveryMs must be at least ${MIN_REPEAT_MS}`);
    }
    const job = {
      id: crypto.randomUUID(),
      deviceId,
      actions,
      runAt: due.toISOString(),
      repeatEveryMs: repeatEveryMs == null ? null : Number(repeatEveryMs),
      status: 'pending',
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    this.state.jobs.push(job);
    await this.store.write(this.state);
    return job;
  }

  async tick(now = Date.now()) {
    for (const job of this.state.jobs) {
      if (job.status !== 'pending' || this.running.has(job.id)) continue;
      if (new Date(job.runAt).getTime() > now) continue;
      this.running.add(job.id);
      job.status = 'running';
      await this.store.write(this.state);
      try {
        await this.actionRunner.run(job.deviceId, job.actions);
        job.lastError = null;
        if (job.repeatEveryMs) {
          job.runAt = new Date(now + job.repeatEveryMs).toISOString();
          job.status = 'pending';
        } else {
          job.status = 'done';
          job.finishedAt = new Date().toISOString();
        }
      } catch (error) {
        job.status = 'failed';
        job.lastError = error.message;
      } finally {
        this.running.delete(job.id);
        await this.store.write(this.state);
      }
    }
  }
}
