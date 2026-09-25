import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRunner } from '../src/core/actionRunner.js';

class FakeBridge {
  constructor() { this.calls = []; this.platform = 'android'; }
  tap(...a){this.calls.push(['tap',...a])}
  swipe(...a){this.calls.push(['swipe',...a])}
  inputText(...a){this.calls.push(['text',...a])}
  launchApp(...a){this.calls.push(['launch',...a])}
  terminateApp(...a){this.calls.push(['terminate',...a])}
  home(...a){this.calls.push(['home',...a])}
  screenshot(){return Buffer.from('png')}
  source(){return '<xml />'}
}

test('ActionRunner routes actions to selected bridge', async () => {
  const bridge = new FakeBridge();
  const manager = { bridgeFor: () => ({ bridge, rawId: 'serial' }) };
  const runner = new ActionRunner(manager);
  const result = await runner.run('android:serial', [
    {type:'tap',x:1,y:2},
    {type:'text',text:'hello'},
    {type:'home'}
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(bridge.calls, [
    ['tap','serial',1,2],
    ['text','serial','hello'],
    ['home','serial']
  ]);
});
