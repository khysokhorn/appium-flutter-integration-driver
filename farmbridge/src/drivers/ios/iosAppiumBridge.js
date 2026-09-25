import { DeviceBridge } from '../../core/deviceBridge.js';
import { IosDiscovery } from './iosDiscovery.js';

export class IosAppiumBridge extends DeviceBridge {
  constructor({ appiumUrl = process.env.APPIUM_URL || 'http://127.0.0.1:4723' } = {}) {
    super('ios');
    this.baseUrl = appiumUrl.replace(/\/$/, '');
    this.discovery = new IosDiscovery();
    this.sessions = new Map();
  }

  async listDevices() {
    return this.discovery.listDevices();
  }

  async tap(deviceId, x, y) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/actions`, {
      actions: [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
    await this.#releaseActions(sessionId);
  }

  async swipe(deviceId, x1, y1, x2, y2, durationMs = 400) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/actions`, {
      actions: [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: x1, y: y1, origin: 'viewport' },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: durationMs, x: x2, y: y2, origin: 'viewport' },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
    await this.#releaseActions(sessionId);
  }

  async inputText(deviceId, text) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/keys`, {
      text,
      value: [...text],
    });
  }

  async launchApp(deviceId, bundleId) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/appium/device/activate_app`, { bundleId });
  }

  async terminateApp(deviceId, bundleId) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/appium/device/terminate_app`, { bundleId });
  }

  async home(deviceId) {
    const sessionId = await this.#session(deviceId);
    await this.#request('POST', `/session/${sessionId}/execute/sync`, {
      script: 'mobile: pressButton',
      args: [{ name: 'home' }],
    });
  }

  async screenshot(deviceId) {
    const sessionId = await this.#session(deviceId);
    const result = await this.#request('GET', `/session/${sessionId}/screenshot`);
    return Buffer.from(result.value, 'base64');
  }

  async source(deviceId) {
    const sessionId = await this.#session(deviceId);
    const result = await this.#request('GET', `/session/${sessionId}/source`);
    return result.value;
  }

  async close() {
    await Promise.all([...this.sessions.values()].map(async sessionId => {
      try { await this.#request('DELETE', `/session/${sessionId}`); } catch { /* best effort */ }
    }));
    this.sessions.clear();
  }

  async #session(deviceId) {
    if (this.sessions.has(deviceId)) return this.sessions.get(deviceId);
    const body = {
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': deviceId,
          'appium:noReset': true,
          'appium:newCommandTimeout': 300,
        },
        firstMatch: [{}],
      },
    };
    const result = await this.#request('POST', '/session', body);
    const sessionId = result.sessionId || result.value?.sessionId;
    if (!sessionId) throw new Error('Appium did not return a session id');
    this.sessions.set(deviceId, sessionId);
    return sessionId;
  }

  async #releaseActions(sessionId) {
    try { await this.#request('DELETE', `/session/${sessionId}/actions`); } catch { /* Appium versions differ */ }
  }

  async #request(method, route, body) {
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await response.json(); } catch { /* leave null */ }
    if (!response.ok || json?.value?.error) {
      const message = json?.value?.message || `${method} ${route} failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return json || {};
  }
}
