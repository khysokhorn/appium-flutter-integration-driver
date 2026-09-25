import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_WAIT_MS = 60_000;

export class ActionRunner {
  constructor(deviceManager) {
    this.deviceManager = deviceManager;
  }

  async run(deviceId, actions = []) {
    if (!Array.isArray(actions)) throw new Error('actions must be an array');
    const { bridge, rawId } = this.deviceManager.bridgeFor(deviceId);
    const results = [];

    for (const action of actions) {
      results.push(await this.#runOne(bridge, rawId, action));
    }
    return results;
  }

  async #runOne(bridge, deviceId, action) {
    switch (action.type) {
      case 'tap':
        await bridge.tap(deviceId, number(action.x, 'x'), number(action.y, 'y'));
        return { type: action.type, ok: true };
      case 'swipe':
        await bridge.swipe(
          deviceId,
          number(action.x1, 'x1'), number(action.y1, 'y1'),
          number(action.x2, 'x2'), number(action.y2, 'y2'),
          action.durationMs == null ? 400 : number(action.durationMs, 'durationMs'),
        );
        return { type: action.type, ok: true };
      case 'text':
        await bridge.inputText(deviceId, requiredString(action.text, 'text'));
        return { type: action.type, ok: true };
      case 'launch':
        await bridge.launchApp(deviceId, requiredString(action.appId, 'appId'));
        return { type: action.type, ok: true };
      case 'terminate':
        await bridge.terminateApp(deviceId, requiredString(action.appId, 'appId'));
        return { type: action.type, ok: true };
      case 'home':
        await bridge.home(deviceId);
        return { type: action.type, ok: true };
      case 'wait': {
        const ms = Math.min(number(action.ms, 'ms'), MAX_WAIT_MS);
        if (ms < 0) throw new Error('wait ms must be >= 0');
        await new Promise(resolve => setTimeout(resolve, ms));
        return { type: action.type, ok: true, ms };
      }
      case 'screenshot': {
        const data = await bridge.screenshot(deviceId);
        if (action.path) {
          const target = path.resolve(requiredString(action.path, 'path'));
          await fs.writeFile(target, data);
          return { type: action.type, ok: true, path: target };
        }
        return { type: action.type, ok: true, base64: data.toString('base64') };
      }
      case 'source':
        return { type: action.type, ok: true, source: await bridge.source(deviceId) };
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} is required`);
  return value;
}

function number(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}
