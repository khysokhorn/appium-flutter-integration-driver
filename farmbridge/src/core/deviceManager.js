export class DeviceManager {
  constructor(bridges) {
    this.bridges = bridges;
  }

  async listDevices() {
    const results = await Promise.all(this.bridges.map(async bridge => {
      try {
        return await bridge.listDevices();
      } catch (error) {
        return [{
          id: `${bridge.platform}:unavailable`,
          platform: bridge.platform,
          name: `${bridge.platform} bridge unavailable`,
          state: 'unavailable',
          error: error.message,
        }];
      }
    }));
    return results.flat();
  }

  bridgeFor(deviceId) {
    const [platform, rawId] = String(deviceId).split(/:(.+)/);
    const bridge = this.bridges.find(x => x.platform === platform);
    if (!bridge || !rawId) throw new Error(`Unsupported device id: ${deviceId}`);
    return { bridge, rawId };
  }
}
