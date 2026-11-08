/** Measure frames over wall time and adapt resolution only after sustained load. */
export class FramePacer {
  constructor() {
    this.reset();
  }

  reset() {
    this.seconds = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  /** Return an FPS sample and resolution step after approximately one second. */
  sample(frameTime) {
    if (!Number.isFinite(frameTime) || frameTime <= 0) return null;
    // A tab can be suspended for minutes; account for a long stall without
    // treating time spent in the background as a gameplay benchmark.
    this.seconds += Math.min(frameTime, 0.5);
    this.frames++;
    if (this.seconds < 1) return null;
    const fps = this.frames / this.seconds;
    this.seconds = 0;
    this.frames = 0;
    let step = 0;
    if (fps < 50) {
      this.slowWindows++;
      this.fastWindows = 0;
      if (this.slowWindows >= 2) {
        step = -0.12;
        this.slowWindows = 0;
      }
    } else if (fps > 57) {
      this.fastWindows++;
      this.slowWindows = 0;
      if (this.fastWindows >= 4) {
        step = 0.06;
        this.fastWindows = 0;
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
    return { fps, step };
  }
}
