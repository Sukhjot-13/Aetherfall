/**
 * Fully procedural audio: wind ambience, a night pad and synthesised spell /
 * UI effects. No audio assets, no network requests. The context starts only
 * after a user gesture, as browsers require.
 */

export class AudioManager {
  constructor(volume = 0.7) {
    this.ctx = null;
    this.master = null;
    this.volume = volume;
    this.muted = false;
    this.night = 0;
    this.noiseBuffer = null;
    this.ambience = null;
    this.nightPad = null;
    this.ready = false;
  }

  /** Create the audio graph. Safe to call repeatedly. */
  async init() {
    if (this.ready) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoise(2.5);
      this._startAmbience();
      this._startNightPad();
      this.ready = true;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      this.ready = false;
    }
  }

  /** Resume after a gesture. */
  async resume() {
    if (!this.ready) return this.init();
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  /** 0 = day, 1 = deep night. */
  setNight(factor) {
    this.night = Math.max(0, Math.min(1, factor));
    if (this.nightPad) {
      const target = 0.02 + this.night * 0.05;
      this.nightPad.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 1.5);
    }
  }

  _makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  _startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.055;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);

    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.ambience = { src, filter, gain, lfo };
  }

  _startNightPad() {
    const gain = this.ctx.createGain();
    gain.gain.value = 0.02;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.connect(gain).connect(this.master);

    for (const [freq, detune] of [
      [110, -6],
      [164.81, 5],
      [220, 11],
    ]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.value = 0.33;
      osc.connect(g).connect(filter);
      osc.start();
    }
    this.nightPad = { gain, filter };
  }

  _tone({ freq = 440, endFreq = null, dur = 0.2, type = 'sine', gain = 0.12, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise({ dur = 0.2, freq = 1200, q = 1, gain = 0.1, type = 'bandpass', delay = 0, sweep = null }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  cast(spellId) {
    switch (spellId) {
      case 'emberBolt':
        this._noise({ dur: 0.22, freq: 900, sweep: 200, gain: 0.09, type: 'lowpass' });
        this._tone({ freq: 420, endFreq: 120, dur: 0.28, type: 'sawtooth', gain: 0.05 });
        break;
      case 'frostNova':
        this._tone({ freq: 880, endFreq: 1760, dur: 0.5, type: 'sine', gain: 0.07 });
        this._tone({ freq: 1320, endFreq: 660, dur: 0.6, type: 'triangle', gain: 0.05, delay: 0.05 });
        this._noise({ dur: 0.5, freq: 4200, q: 2, gain: 0.04, type: 'highpass' });
        break;
      case 'galeDash':
        this._noise({ dur: 0.32, freq: 400, sweep: 2400, gain: 0.11, type: 'bandpass', q: 0.8 });
        break;
      case 'stormLance':
        this._noise({ dur: 0.35, freq: 2400, sweep: 300, gain: 0.12, type: 'highpass' });
        this._tone({ freq: 90, endFreq: 40, dur: 0.4, type: 'square', gain: 0.07 });
        break;
      case 'aegis':
        this._tone({ freq: 330, endFreq: 660, dur: 0.6, type: 'sine', gain: 0.08 });
        this._tone({ freq: 495, endFreq: 990, dur: 0.7, type: 'sine', gain: 0.05, delay: 0.08 });
        break;
      case 'aetherForm':
        this._tone({ freq: 110, endFreq: 440, dur: 1.2, type: 'sawtooth', gain: 0.05 });
        this._tone({ freq: 220, endFreq: 880, dur: 1.4, type: 'sine', gain: 0.07, delay: 0.1 });
        this._noise({ dur: 1.2, freq: 300, sweep: 3000, gain: 0.05, type: 'bandpass' });
        break;
      default:
        this._tone({ freq: 440, dur: 0.15, gain: 0.06 });
    }
  }

  hit() {
    this._noise({ dur: 0.09, freq: 900, q: 1.2, gain: 0.06, type: 'bandpass' });
  }

  enemyHit() {
    this._tone({ freq: 160, endFreq: 90, dur: 0.12, type: 'triangle', gain: 0.05 });
    this._noise({ dur: 0.08, freq: 1400, gain: 0.04 });
  }

  damage() {
    this._tone({ freq: 130, endFreq: 60, dur: 0.3, type: 'sawtooth', gain: 0.08 });
    this._noise({ dur: 0.2, freq: 500, gain: 0.06, type: 'lowpass' });
  }

  death() {
    this._tone({ freq: 220, endFreq: 40, dur: 1.4, type: 'sine', gain: 0.1 });
    this._noise({ dur: 1.2, freq: 900, sweep: 100, gain: 0.05, type: 'lowpass' });
  }

  jump() {
    this._noise({ dur: 0.14, freq: 500, sweep: 1200, gain: 0.04, type: 'bandpass' });
  }

  /** Quick cloth-and-air dodge whoosh. */
  dodge() {
    this._noise({ dur: 0.24, freq: 700, sweep: 2600, gain: 0.055, type: 'bandpass', q: 0.7 });
    this._tone({ freq: 300, endFreq: 120, dur: 0.16, type: 'sine', gain: 0.025 });
  }

  /** Touchdown thump; `force` is 0 (soft) .. 1 (heavy). */
  land(force = 0.4) {
    const f = Math.min(1, Math.max(0, force));
    this._noise({ dur: 0.12 + f * 0.1, freq: 240 + f * 180, q: 0.7, gain: 0.025 + f * 0.05, type: 'lowpass' });
    this._tone({ freq: 95 + f * 30, endFreq: 52, dur: 0.16 + f * 0.1, type: 'sine', gain: 0.025 + f * 0.05 });
  }

  footstep(surface = 'grass') {
    const freq = surface === 'rock' ? 1400 : surface === 'sand' ? 700 : 950;
    this._noise({ dur: 0.07, freq, q: 0.8, gain: 0.022, type: 'bandpass' });
  }

  pickup() {
    const notes = [880, 1320, 1760];
    notes.forEach((f, i) => this._tone({ freq: f, dur: 0.35, type: 'sine', gain: 0.07, delay: i * 0.07 }));
  }

  quest() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone({ freq: f, dur: 1.1, type: 'sine', gain: 0.05, delay: i * 0.1 }),
    );
  }

  beacon() {
    [130.81, 196, 261.63, 392, 523.25].forEach((f, i) =>
      this._tone({ freq: f, dur: 3.2, type: 'sine', gain: 0.06, delay: i * 0.16 }),
    );
    this._noise({ dur: 3, freq: 200, sweep: 6000, gain: 0.04, type: 'bandpass' });
  }

  /** The Sovereign tears its way out of the Veil. */
  bossIntro() {
    this._tone({ freq: 48, endFreq: 34, dur: 2.4, type: 'sawtooth', gain: 0.09 });
    this._tone({ freq: 73, endFreq: 55, dur: 2.8, type: 'sine', gain: 0.07, delay: 0.2 });
    this._noise({ dur: 2.2, freq: 180, sweep: 2400, gain: 0.06, type: 'lowpass' });
    [196, 233.08, 311.13].forEach((f, i) =>
      this._tone({ freq: f, dur: 1.8, type: 'triangle', gain: 0.035, delay: 1 + i * 0.12 }),
    );
  }

  /** Phase break: a choral stab and a falling roar. */
  bossPhase() {
    this._tone({ freq: 110, endFreq: 55, dur: 1.1, type: 'sawtooth', gain: 0.08 });
    this._tone({ freq: 440, endFreq: 220, dur: 0.9, type: 'triangle', gain: 0.05 });
    this._noise({ dur: 0.9, freq: 900, sweep: 120, gain: 0.07, type: 'bandpass' });
  }

  /** Ground slam / shockwave. */
  bossSlam() {
    this._tone({ freq: 72, endFreq: 32, dur: 0.7, type: 'sine', gain: 0.13 });
    this._tone({ freq: 144, endFreq: 48, dur: 0.5, type: 'triangle', gain: 0.05 });
    this._noise({ dur: 0.55, freq: 260, sweep: 80, gain: 0.09, type: 'lowpass' });
  }

  /** Volley / blade wind-up. */
  bossVolley() {
    this._noise({ dur: 0.34, freq: 500, sweep: 3200, gain: 0.05, type: 'bandpass' });
    this._tone({ freq: 220, endFreq: 660, dur: 0.28, type: 'triangle', gain: 0.035 });
  }

  /** The Sovereign comes apart. */
  bossDeath() {
    this._tone({ freq: 220, endFreq: 30, dur: 3.4, type: 'sawtooth', gain: 0.09 });
    this._tone({ freq: 110, endFreq: 24, dur: 4, type: 'sine', gain: 0.08 });
    this._noise({ dur: 3.2, freq: 1800, sweep: 90, gain: 0.07, type: 'lowpass' });
    [261.63, 329.63, 392, 523.25].forEach((f, i) =>
      this._tone({ freq: f, dur: 3.6, type: 'sine', gain: 0.045, delay: 0.6 + i * 0.14 }),
    );
  }

  ui() {
    this._tone({ freq: 660, endFreq: 880, dur: 0.08, type: 'sine', gain: 0.04 });
  }

  error() {
    this._tone({ freq: 180, endFreq: 120, dur: 0.18, type: 'square', gain: 0.035 });
  }
}
