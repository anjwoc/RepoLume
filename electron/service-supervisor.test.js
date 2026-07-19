const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { ServiceSupervisor } = require('./service-supervisor');

function child() {
  const value = new EventEmitter();
  value.exitCode = null;
  return value;
}

test('restarts a failed service with bounded exponential delays', async () => {
  const children = [];
  const timers = [];
  const supervisor = new ServiceSupervisor({
    name: 'api',
    launch() {
      const launched = child();
      children.push(launched);
      return launched;
    },
    stopChild() {},
    probe: async () => {},
    onCrashLoop() {
      assert.fail('crash loop should not open yet');
    },
    setTimer(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer() {},
    now: () => 100,
  });

  supervisor.start();
  children[0].exitCode = 1;
  children[0].emit('exit', 1, null);

  assert.equal(timers[0].delay, 500);
  await timers[0].callback();
  assert.equal(children.length, 2);
});

test('opens the crash loop breaker after the restart budget is exhausted', () => {
  const children = [];
  const timers = [];
  const crashLoops = [];
  let clock = 0;
  const supervisor = new ServiceSupervisor({
    name: 'web',
    launch() {
      const launched = child();
      children.push(launched);
      return launched;
    },
    stopChild() {},
    probe: async () => {},
    onCrashLoop: (state) => crashLoops.push(state),
    maxRestarts: 2,
    setTimer(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer() {},
    now: () => clock,
  });

  supervisor.start();
  children[0].emit('exit', 1, null);
  clock += 1;
  supervisor.startChild().emit('exit', 1, null);
  clock += 1;
  supervisor.startChild().emit('exit', 1, null);

  assert.equal(crashLoops.length, 1);
  assert.equal(crashLoops[0].name, 'web');
  assert.equal(timers[0].delay, 500);
  assert.equal(timers[1].delay, 1000);
});

test('stop cancels a pending restart and terminates the current child', () => {
  const children = [];
  const stopped = [];
  const cleared = [];
  const supervisor = new ServiceSupervisor({
    name: 'api',
    launch() {
      const launched = child();
      children.push(launched);
      return launched;
    },
    stopChild: (value) => stopped.push(value),
    probe: async () => {},
    setTimer() {
      return 42;
    },
    clearTimer: (timer) => cleared.push(timer),
  });

  supervisor.start();
  children[0].emit('exit', 1, null);
  const current = supervisor.startChild();
  supervisor.stop();

  assert.deepEqual(cleared, [42]);
  assert.deepEqual(stopped, [current]);
});
