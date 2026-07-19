class ServiceSupervisor {
  constructor({
    name,
    launch,
    stopChild,
    probe,
    onCrashLoop,
    maxRestarts = 3,
    restartWindowMs = 60_000,
    baseDelayMs = 500,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
  }) {
    this.name = name;
    this.launch = launch;
    this.stopChild = stopChild;
    this.probe = probe;
    this.onCrashLoop = onCrashLoop;
    this.maxRestarts = maxRestarts;
    this.restartWindowMs = restartWindowMs;
    this.baseDelayMs = baseDelayMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.child = null;
    this.restartTimer = null;
    this.restartTimestamps = [];
    this.stopping = false;
    this.generation = 0;
  }

  start() {
    this.stopping = false;
    return this.startChild();
  }

  startChild() {
    const child = this.launch();
    const generation = ++this.generation;
    this.child = child;
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.stopping && generation === this.generation) {
        this.scheduleRestart({ code, signal });
      }
    });
    return child;
  }

  scheduleRestart(reason) {
    const timestamp = this.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (recorded) => timestamp - recorded <= this.restartWindowMs,
    );
    if (this.restartTimestamps.length >= this.maxRestarts) {
      this.onCrashLoop?.({ name: this.name, reason, restarts: this.restartTimestamps.length });
      return;
    }
    this.restartTimestamps.push(timestamp);
    const delay = this.baseDelayMs * 2 ** (this.restartTimestamps.length - 1);
    this.restartTimer = this.setTimer(async () => {
      this.restartTimer = null;
      if (this.stopping) return;
      const child = this.startChild();
      try {
        await this.probe();
      } catch (error) {
        if (this.child === child) {
          this.stopChild(child);
        }
      }
    }, delay);
  }

  stop() {
    this.stopping = true;
    this.generation += 1;
    if (this.restartTimer !== null) {
      this.clearTimer(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (child) this.stopChild(child);
  }
}

module.exports = { ServiceSupervisor };
