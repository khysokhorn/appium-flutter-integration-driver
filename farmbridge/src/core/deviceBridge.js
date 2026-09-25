export class DeviceBridge {
  constructor(platform) {
    this.platform = platform;
  }

  async listDevices() { throw new Error('Not implemented'); }
  async tap(_deviceId, _x, _y) { throw new Error('Not implemented'); }
  async swipe(_deviceId, _x1, _y1, _x2, _y2, _durationMs) { throw new Error('Not implemented'); }
  async inputText(_deviceId, _text) { throw new Error('Not implemented'); }
  async launchApp(_deviceId, _appId) { throw new Error('Not implemented'); }
  async terminateApp(_deviceId, _appId) { throw new Error('Not implemented'); }
  async home(_deviceId) { throw new Error('Not implemented'); }
  async screenshot(_deviceId) { throw new Error('Not implemented'); }
  async source(_deviceId) { throw new Error('Not implemented'); }
}
