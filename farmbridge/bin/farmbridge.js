#!/usr/bin/env node
import fs from 'node:fs/promises';
import { AdbBridge } from '../src/drivers/android/adbBridge.js';
import { IosAppiumBridge } from '../src/drivers/ios/iosAppiumBridge.js';
import { DeviceManager } from '../src/core/deviceManager.js';
import { ActionRunner } from '../src/core/actionRunner.js';

const manager = new DeviceManager([new AdbBridge(), new IosAppiumBridge()]);
const runner = new ActionRunner(manager);
const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'devices') {
    console.log(JSON.stringify(await manager.listDevices(), null, 2));
  } else if (command === 'run') {
    const [deviceId, workflowFile] = args;
    if (!deviceId || !workflowFile) usage(1);
    const workflow = JSON.parse(await fs.readFile(workflowFile, 'utf8'));
    console.log(JSON.stringify(await runner.run(deviceId, workflow.actions || workflow), null, 2));
  } else {
    usage(command ? 1 : 0);
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

function usage(code) {
  console.log(`Usage:\n  farmbridge devices\n  farmbridge run <android:serial|ios:udid> <workflow.json>`);
  process.exit(code);
}
