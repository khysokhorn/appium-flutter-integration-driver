import { runFile } from '../../utils/process.js';

export class IosDiscovery {
  async listDevices() {
    const devices = new Map();

    try {
      const { stdout } = await runFile('xcrun', ['simctl', 'list', 'devices', '--json']);
      const json = JSON.parse(stdout);
      for (const group of Object.values(json.devices || {})) {
        for (const d of group) {
          if (!d.isAvailable) continue;
          devices.set(d.udid, {
            udid: d.udid,
            name: d.name,
            kind: 'simulator',
            state: String(d.state || 'unknown').toLowerCase(),
          });
        }
      }
    } catch {
      // Full Xcode may not be installed. Physical discovery below can still provide a useful error upstream.
    }

    try {
      const { stdout } = await runFile('xcrun', ['xctrace', 'list', 'devices']);
      for (const d of parseXctraceDevices(stdout)) {
        if (!devices.has(d.udid)) devices.set(d.udid, d);
      }
    } catch (error) {
      if (devices.size === 0) throw error;
    }

    return [...devices.values()].map(d => ({
      ...d,
      id: `ios:${d.udid}`,
      platform: 'ios',
    }));
  }
}

export function parseXctraceDevices(output) {
  const result = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('==') || /Mac.*\([^)]+\)$/.test(line)) continue;
    const match = line.match(/^(.*?)\s+\((?:[^()]*)\)\s+\(([0-9A-Fa-f-]{8,})\)(?:\s+\(Simulator\))?$/);
    if (!match) continue;
    const name = match[1].trim();
    const udid = match[2];
    result.push({
      udid,
      name,
      kind: line.endsWith('(Simulator)') ? 'simulator' : 'physical',
      state: 'unknown',
    });
  }
  return result;
}
