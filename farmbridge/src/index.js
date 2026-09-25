import { AdbBridge } from './drivers/android/adbBridge.js';
import { IosAppiumBridge } from './drivers/ios/iosAppiumBridge.js';
import { DeviceManager } from './core/deviceManager.js';
import { ActionRunner } from './core/actionRunner.js';
import { JsonStore } from './storage/jsonStore.js';
import { Scheduler } from './scheduler/scheduler.js';
import { createHttpServer } from './server/httpServer.js';
import { Studio } from './studio/studio.js';

const android = new AdbBridge();
const ios = new IosAppiumBridge();
const deviceManager = new DeviceManager([android, ios]);
const actionRunner = new ActionRunner(deviceManager);
const scheduler = new Scheduler({ store: new JsonStore(), actionRunner });
await scheduler.start();
const studio = new Studio({ deviceManager });
await studio.start();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const server = createHttpServer({ deviceManager, actionRunner, scheduler, studio });
server.listen(port, host, () => {
  console.log(`FarmBridge listening at http://${host}:${port}`);
});

async function shutdown() {
  await scheduler.stop();
  studio.stop();
  await ios.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
