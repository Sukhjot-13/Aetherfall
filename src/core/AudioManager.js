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
    if (this.ambience?.nightGain) {
      const target = 0.0035 + this.night * 0.0075;
      this.ambience.nightGain.gain.setTargetAtTime(target, this.ctx.currentTime, 1.2);
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

    // Second bed for sea wash: slower, lower and much quieter than the wind.
    // It keeps the island breathing at night without competing with footsteps.
    const seaSrc = this.ctx.createBufferSource();
    seaSrc.buffer = this.noiseBuffer;
    seaSrc.loop = true;
    const seaFilter = this.ctx.createBiquadFilter();
    seaFilter.type = 'lowpass';
    seaFilter.frequency.value = 260;
    seaFilter.Q.value = 0.5;
    const seaGain = this.ctx.createGain();
    seaGain.gain.value = 0.026;
    const seaLfo = this.ctx.createOscillator();
    seaLfo.frequency.value = 0.032;
    const seaLfoGain = this.ctx.createGain();
    seaLfoGain.gain.value = 70;
    seaLfo.connect(seaLfoGain).connect(seaFilter.frequency);
    seaSrc.connect(seaFilter).connect(seaGain).connect(this.master);
    seaSrc.start();
    seaLfo.start();

    // Forest bed: leaves whispering (bandpass noise, slow flutter).
    const forestSrc = this.ctx.createBufferSource();
    forestSrc.buffer = this.noiseBuffer;
    forestSrc.loop = true;
    const forestFilter = this.ctx.createBiquadFilter();
    forestFilter.type = 'bandpass';
    forestFilter.frequency.value = 1400;
    forestFilter.Q.value = 0.5;
    const forestGain = this.ctx.createGain();
    forestGain.gain.value = 0.0;
    const forestLfo = this.ctx.createOscillator();
    forestLfo.frequency.value = 0.7;
    const forestLfoGain = this.ctx.createGain();
    forestLfoGain.gain.value = 0.008;
    forestLfo.connect(forestLfoGain).connect(forestGain.gain);
    forestSrc.connect(forestFilter).connect(forestGain).connect(this.master);
    forestSrc.start();
    forestLfo.start();

    // Mountain wind: thin, high gusts above the treeline.
    const gustSrc = this.ctx.createBufferSource();
    gustSrc.buffer = this.noiseBuffer;
    gustSrc.loop = true;
    const gustFilter = this.ctx.createBiquadFilter();
    gustFilter.type = 'bandpass';
    gustFilter.frequency.value = 900;
    gustFilter.Q.value = 0.3;
    const gustGain = this.ctx.createGain();
    gustGain.gain.value = 0.0;
    const gustLfo = this.ctx.createOscillator();
    gustLfo.frequency.value = 0.11;
    const gustLfoGain = this.ctx.createGain();
    gustLfoGain.gain.value = 0.02;
    gustLfo.connect(gustLfoGain).connect(gustGain.gain);
    gustSrc.connect(gustFilter).connect(gustGain).connect(this.master);
    gustSrc.start();
    gustLfo.start();

    // Night insects: a very soft high hiss that only becomes audible after
    // dark, so daytime stays clean and the forest feels alive at night.
    const nightSrc = this.ctx.createBufferSource();
    nightSrc.buffer = this.noiseBuffer;
    nightSrc.loop = true;
    const nightFilter = this.ctx.createBiquadFilter();
    nightFilter.type = 'highpass';
    nightFilter.frequency.value = 3800;
    const nightGain = this.ctx.createGain();
    nightGain.gain.value = 0.0;
    nightSrc.connect(nightFilter).connect(nightGain).connect(this.master);
    nightSrc.start();

    this.ambience = { src, filter, gain, lfo, seaSrc, seaFilter, seaGain, seaLfo, nightSrc, nightGain, forestGain, forestFilter, gustGain, gustFilter };
  }

  /**
   * Blend ambience to the player's actual environment: shore wash by the
   * water, leaf whisper in the woods, thin gusts at altitude, insects at
   * night. Call ~2×/s from the frame loop.
   */
  setEnvironment({ shore = 1, forest = 0, altitude = 0 } = {}) {
    if (!this.ready || !this.ambience) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, shore));
    const f = Math.max(0, Math.min(1, forest));
    const a = Math.max(0, Math.min(1, altitude));
    if (this.ambience.seaGain) {
      this.ambience.seaGain.gain.setTargetAtTime(0.055 - s * 0.033, t, 0.6);
    }
    if (this.ambience.forestGain) {
      this.ambience.forestGain.gain.setTargetAtTime(0.004 + f * 0.022, t, 0.8);
      this.ambience.forestFilter.frequency.setTargetAtTime(1100 + f * 700, t, 0.8);
    }
    if (this.ambience.gustGain) {
      this.ambience.gustGain.gain.setTargetAtTime(a * 0.028, t, 1.0);
    }
    if (this.ambience.nightGain) {
      const target = 0.0035 + this.night * 0.0075 + f * this.night * 0.004;
      this.ambience.nightGain.gain.setTargetAtTime(target, t, 0.8);
    }
  }

  /** Distance to open water; used to weight sea, wind and insect beds. */
  setBiomeBlend(shoreDistance) {
    return this.setEnvironment({ shore: Math.max(0, Math.min(1, shoreDistance)) });
  }

  /**
   * Biome sting matched to the background the player actually sees:
   * dawn-chorus birds in meadow/forest by day, frog croaks at water,
   * owl hoots at night, thin wind keening at altitude. Procedural and
   * lo-fi so it reads as creatures, not synth beeps. Called ~0.8 Hz.
   */
  biomeSting({ shore = 0, forest = 0, altitude = 0, night = 0 } = {}) {
    if (!this.ready) return;
    const s = Math.max(0, Math.min(1, shore));
    const f = Math.max(0, Math.min(1, forest));
    const a = Math.max(0, Math.min(1, altitude));
    const n = Math.max(0, Math.min(1, night));
    const r = Math.random();
    if (n > 0.6) {
      // Owl / night peeper: low hoot, occasional.
      if (r < 0.28 + f * 0.2) {
        const base = 340 + Math.random() * 60;
        this._tone({ freq: base, endFreq: base * 0.82, dur: 0.34, type: 'sine', gain: 0.022 });
        this._tone({ freq: base * 1.18, endFreq: base * 0.9, dur: 0.26, type: 'sine', gain: 0.014, delay: 0.42 });
      } else if (s > 0.5 && r < 0.55) {
        // Frog croak by the water at night.
        this._tone({ freq: 120, endFreq: 70, dur: 0.12, type: 'square', gain: 0.018 });
        this._tone({ freq: 115, endFreq: 65, dur: 0.12, type: 'square', gain: 0.016, delay: 0.16 });
      }
      return;
    }
    // Day: dawn chorus arpeggios, denser in forest/meadow.
    const birdChance = 0.22 + f * 0.45 + (1 - s) * 0.1;
    if (r < birdChance) {
      const base = 1800 + Math.random() * 1400;
      const notes = [1, 1.18, 1.42, 1.18];
      notes.forEach((m, i) => {
        if (i === 0 || Math.random() < 0.75) {
          this._tone({ freq: base * m, endFreq: base * m * 1.28, dur: 0.09, type: 'triangle', gain: 0.016, delay: i * 0.075 });
        }
      });
    }
    // Altitude keening: thin high wind whistle.
    if (a > 0.45 && Math.random() < 0.35) {
      this._tone({ freq: 2600 + Math.random() * 600, endFreq: 2100, dur: 0.6, type: 'sine', gain: 0.006 });
    }
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
        this._noise({ dur: 0.28, freq: 1100, sweep: 160, gain: 0.1, type: 'lowpass' });
        this._tone({ freq: 520, endFreq: 110, dur: 0.34, type: 'sawtooth', gain: 0.055 });
        this._tone({ freq: 180, endFreq: 60, dur: 0.4, type: 'triangle', gain: 0.04, delay: 0.02 });
        break;
      case 'frostNova':
        this._tone({ freq: 880, endFreq: 1760, dur: 0.5, type: 'sine', gain: 0.07 });
        this._tone({ freq: 1320, endFreq: 660, dur: 0.6, type: 'triangle', gain: 0.05, delay: 0.05 });
        this._noise({ dur: 0.5, freq: 4200, q: 2, gain: 0.04, type: 'highpass' });
        this._tone({ freq: 308, endFreq: 154, dur: 0.7, type: 'sine', gain: 0.04, delay: 0.02 });
        break;
      case 'galeDash':
        this._noise({ dur: 0.34, freq: 420, sweep: 2600, gain: 0.12, type: 'bandpass', q: 0.8 });
        this._tone({ freq: 240, endFreq: 90, dur: 0.22, type: 'sine', gain: 0.03 });
        break;
      case 'stormLance':
        this._noise({ dur: 0.42, freq: 2600, sweep: 260, gain: 0.13, type: 'highpass' });
        this._tone({ freq: 90, endFreq: 40, dur: 0.5, type: 'square', gain: 0.08 });
        this._tone({ freq: 440, endFreq: 55, dur: 0.38, type: 'sawtooth', gain: 0.06, delay: 0.03 });
        break;
      case 'aegis':
        this._tone({ freq: 330, endFreq: 660, dur: 0.6, type: 'sine', gain: 0.08 });
        this._tone({ freq: 495, endFreq: 990, dur: 0.7, type: 'sine', gain: 0.05, delay: 0.08 });
        this._noise({ dur: 0.6, freq: 1200, sweep: 2400, gain: 0.03, type: 'bandpass' });
        break;
      case 'aetherForm':
        this._tone({ freq: 110, endFreq: 440, dur: 1.2, type: 'sawtooth', gain: 0.05 });
        this._tone({ freq: 220, endFreq: 880, dur: 1.4, type: 'sine', gain: 0.07, delay: 0.1 });
        this._noise({ dur: 1.2, freq: 300, sweep: 3000, gain: 0.05, type: 'bandpass' });
        this._tone({ freq: 440, endFreq: 1760, dur: 1.5, type: 'sine', gain: 0.035, delay: 0.22 });
        break;
      case 'rimeSpear':
        this._tone({ freq: 1180, endFreq: 290, dur: 0.42, type: 'triangle', gain: 0.07 });
        this._noise({ dur: 0.34, freq: 3400, sweep: 1200, gain: 0.05, type: 'highpass' });
        break;
      case 'pyreWave':
        this._noise({ dur: 0.55, freq: 700, sweep: 180, gain: 0.1, type: 'lowpass' });
        this._tone({ freq: 165, endFreq: 70, dur: 0.55, type: 'sawtooth', gain: 0.05 });
        this._noise({ dur: 0.35, freq: 1800, sweep: 600, gain: 0.04, type: 'bandpass', delay: 0.08 });
        break;
      case 'thunderfall':
        this._tone({ freq: 660, endFreq: 44, dur: 0.7, type: 'sawtooth', gain: 0.07 });
        this._noise({ dur: 0.5, freq: 2000, sweep: 140, gain: 0.11, type: 'highpass' });
        this._tone({ freq: 55, endFreq: 28, dur: 0.8, type: 'sine', gain: 0.1, delay: 0.04 });
        break;
      case 'aetherBarrage':
        this._noise({ dur: 0.4, freq: 900, sweep: 3400, gain: 0.06, type: 'bandpass', q: 1.4 });
        [880, 1105, 1318, 1760].forEach((f, i) =>
          this._tone({ freq: f, dur: 0.5, type: 'sine', gain: 0.04, delay: i * 0.07 }),
        );
        break;
      default:
        this._tone({ freq: 440, dur: 0.15, gain: 0.06 });
    }
  }

  hit() {
    this._noise({ dur: 0.09, freq: 900, q: 1.2, gain: 0.06, type: 'bandpass' });
  }

  enemyHit() {
    this._tone({ freq: 165, endFreq: 82, dur: 0.14, type: 'triangle', gain: 0.055 });
    this._noise({ dur: 0.09, freq: 1500, gain: 0.045 });
  }

  /** Veil creature dissolves — used on kills so combat has a payoff. */
  enemyDeath() {
    this._tone({ freq: 340, endFreq: 70, dur: 0.55, type: 'triangle', gain: 0.06 });
    this._noise({ dur: 0.4, freq: 1600, sweep: 220, gain: 0.05, type: 'bandpass' });
    this._tone({ freq: 110, endFreq: 44, dur: 0.6, type: 'sine', gain: 0.05, delay: 0.05 });
  }

  /** Warden guarding a shard dies — a heavier, more deliberate payoff. */
  wardenDeath() {
    this._tone({ freq: 220, endFreq: 38, dur: 1.1, type: 'sawtooth', gain: 0.07 });
    this._noise({ dur: 0.9, freq: 1200, sweep: 120, gain: 0.07, type: 'lowpass' });
    [196, 261.63, 329.63, 392].forEach((f, i) =>
      this._tone({ freq: f, dur: 1.4, type: 'sine', gain: 0.045, delay: 0.12 + i * 0.09 }),
    );
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
    this._noise({ dur: 0.15, freq: 480, sweep: 1300, gain: 0.045, type: 'bandpass' });
    this._tone({ freq: 210, endFreq: 120, dur: 0.14, type: 'sine', gain: 0.02 });
  }

  /** Double jump while sky leap is known. */
  doubleJump() {
    this._noise({ dur: 0.18, freq: 460, sweep: 1700, gain: 0.05, type: 'bandpass' });
    this._tone({ freq: 320, endFreq: 190, dur: 0.2, type: 'triangle', gain: 0.03 });
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

  /** Biome fabric: leaf/bird bed that carries the forest so footsteps sit
   *  in a matched soundscape instead of generic noise. */
  footstep(surface = 'grass', biome = null) {
    const f = Math.max(0, Math.min(1, biome ?? 0));
    this._noise({ dur: 0.05 + f * 0.02, freq: (surface === 'water' ? 520 : 900) * (0.9 + Math.random() * 0.2), q: 0.8, gain: 0.012 + f * 0.012, type: 'bandpass' });
    if (surface === 'grass' && f > 0.3) {
      // Leaf rustle layer in the woods.
      this._noise({ dur: 0.09, freq: 1600 * (0.85 + Math.random() * 0.3), q: 0.6, gain: 0.01 * f, type: 'bandpass' });
    } else if (surface === 'rock') {
      this._noise({ dur: 0.06, freq: 1500 * (0.9 + Math.random() * 0.2), q: 1.1, gain: 0.028, type: 'bandpass' });
      this._noise({ dur: 0.045, freq: 2600, q: 2, gain: 0.012, type: 'highpass' });
      this._tone({ freq: 120, endFreq: 65, dur: 0.07, type: 'sine', gain: 0.02 });
      return;
    } else if (surface === 'sand') {
      this._noise({ dur: 0.11, freq: 620, sweep: 320, q: 0.7, gain: 0.03, type: 'bandpass' });
      this._noise({ dur: 0.07, freq: 240, gain: 0.014, type: 'lowpass' });
      return;
    } else if (surface === 'water') {
      this._noise({ dur: 0.16, freq: 520, sweep: 140, gain: 0.032, type: 'bandpass' });
      this._noise({ dur: 0.2, freq: 320, sweep: 110, gain: 0.026, type: 'lowpass' });
      this._tone({ freq: 200, endFreq: 90, dur: 0.09, type: 'sine', gain: 0.012 });
      return;
    }
    // Grass / dirt / snow / forest floor.
    const jitter = 0.9 + Math.random() * 0.2;
    if (surface === 'snow') {
      this._noise({ dur: 0.09, freq: 1100 * jitter, sweep: 500, q: 0.6, gain: 0.026, type: 'bandpass' });
      this._noise({ dur: 0.06, freq: 300 * jitter, gain: 0.012, type: 'lowpass' });
      return;
    }
    this._noise({ dur: 0.075, freq: 920 * jitter, q: 0.8, gain: 0.024, type: 'bandpass' });
    this._noise({ dur: 0.05, freq: 420 * jitter, gain: 0.012, type: 'lowpass' });
    this._tone({ freq: 150 * jitter, endFreq: 85, dur: 0.06, type: 'sine', gain: 0.012 });
  }

  /** Enemy growl / aggro sting, pitched by distance and type. */
  growl(kind = 'stalker') {
    const base = kind === 'warden' ? 82 : kind === 'drifter' ? 300 : 140;
    this._tone({ freq: base, endFreq: base * 0.55, dur: 0.55, type: 'sawtooth', gain: 0.05 });
    this._tone({ freq: base * 1.5, endFreq: base * 0.8, dur: 0.4, type: 'sawtooth', gain: 0.03, delay: 0.04 });
    this._noise({ dur: 0.5, freq: 600, sweep: 160, gain: 0.03, type: 'bandpass', q: 0.9 });
  }

  /** Ambient cloth whoosh scaled by horizontal speed (sprint wind). */
  whoosh(intensity = 0) {
    const t = Math.max(0, Math.min(1, intensity));
    if (!this.ready || t <= 0.02) return;
    this._noise({ dur: 0.3, freq: 500 + t * 1400, q: 0.6, gain: 0.008 + t * 0.035, type: 'bandpass' });
  }

  pickup() {
    const notes = [880, 1320, 1760];
    notes.forEach((f, i) => this._tone({ freq: f, dur: 0.35, type: 'sine', gain: 0.07, delay: i * 0.07 }));
  }

  /** A wisp companion hum — barely there, only when idle nearby. */
  wisp() {
    this._tone({ freq: 1396.91, dur: 0.9, type: 'sine', gain: 0.018 });
    this._tone({ freq: 1760, dur: 1.1, type: 'sine', gain: 0.012, delay: 0.16 });
  }

  /** Sable socializes — warm, human two-note acknowledgement. */
  talk() {
    this._tone({ freq: 392, dur: 0.32, type: 'triangle', gain: 0.035 });
    this._tone({ freq: 523.25, dur: 0.42, type: 'triangle', gain: 0.03, delay: 0.08 });
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
