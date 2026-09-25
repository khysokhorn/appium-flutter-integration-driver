import { DeviceBridge } from '../../core/deviceBridge.js';
import { runFile, runFileBuffer } from '../../utils/process.js';

export class AdbBridge extends DeviceBridge {
  constructor({ adbPath = process.env.ADB_PATH || 'adb' } = {}) {
    super('android');
    this.adbPath = adbPath;
  }

  async listDevices() {
    const { stdout } = await runFile(this.adbPath, ['devices', '-l']);
    return parseAdbDevices(stdout).map(d => ({
      ...d,
      id: `android:${d.serial}`,
      platform: 'android',
      name: d.model || d.serial,
    }));
  }

  async tap(deviceId, x, y) {
    await this.#shell(deviceId, ['input', 'tap', String(x), String(y)]);
  }

  async swipe(deviceId, x1, y1, x2, y2, durationMs = 400) {
    await this.#shell(deviceId, ['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)]);
  }

  async inputText(deviceId, text) {
    const escaped = text.replace(/%/g, '\\%').replace(/ /g, '%s');
    await this.#shell(deviceId, ['input', 'text', escaped]);
  }

  async launchApp(deviceId, packageName) {
    await this.#shell(deviceId, ['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
  }

  async terminateApp(deviceId, packageName) {
    await this.#shell(deviceId, ['am', 'force-stop', packageName]);
  }

  async home(deviceId) {
    await this.#shell(deviceId, ['input', 'keyevent', 'KEYCODE_HOME']);
  }

  async screenshot(deviceId) {
    const { stdout } = await runFileBuffer(this.adbPath, ['-s', deviceId, 'exec-out', 'screencap', '-p']);
    return stdout;
  }

  async source(deviceId) {
    const remote = '/sdcard/farmbridge-window.xml';
    await this.#shell(deviceId, ['uiautomator', 'dump', remote]);
    const { stdout } = await this.#shell(deviceId, ['cat', remote]);
    return stdout;
  }

  async install(deviceId, apkPath) {
    await runFile(this.adbPath, ['-s', deviceId, 'install', '-r', apkPath]);
  }

  async pushFile(deviceId, localPath, remotePath) {
    await runFile(this.adbPath, ['-s', deviceId, 'push', localPath, remotePath]);
  }

  async #shell(deviceId, args) {
    return runFile(this.adbPath, ['-s', deviceId, 'shell', ...args]);
  }
}

export function parseAdbDevices(output) {
  const lines = output.split(/\r?\n/).slice(1).map(x => x.trim()).filter(Boolean);
  return lines.map(line => {
    const [serial, state, ...parts] = line.split(/\s+/);
    const attrs = Object.fromEntries(parts.filter(x => x.includes(':')).map(x => {
      const idx = x.indexOf(':');
      return [x.slice(0, idx), x.slice(idx + 1)];
    }));
    return {
      serial,
      state,
      model: attrs.model?.replace(/_/g, ' ') || null,
      product: attrs.product || null,
      device: attrs.device || null,
      transportId: attrs.transport_id || null,
    };
  });
}
