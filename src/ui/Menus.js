/**
 * Screen manager for the title, pause, settings, death and ending overlays.
 * Owns all button wiring and the settings form; emits intent via handlers so
 * the game loop stays the single source of truth.
 */

import { normalizeSettings, QUALITY_PRESETS } from '../core/settings.js';

export class Menus {
  /**
   * @param {{doc?:Document, handlers?:Record<string, Function>, getSettings?:Function, onSettingsChange?:Function}} opts
   */
  constructor({ doc = document, handlers = {}, getSettings, onSettingsChange } = {}) {
    this.doc = doc;
    this.handlers = handlers;
    this.getSettings = getSettings ?? (() => ({}));
    this.onSettingsChange = onSettingsChange ?? (() => {});
    this.settingsOrigin = 'title';

    this.screens = {
      loading: doc.getElementById('loading'),
      title: doc.getElementById('title'),
      pause: doc.getElementById('pause'),
      settings: doc.getElementById('settings'),
      death: doc.getElementById('death'),
      ending: doc.getElementById('ending'),
      rematch: doc.getElementById('rematch'),
    };

    this.els = {
      loadingFill: doc.getElementById('loading-fill'),
      loadingText: doc.getElementById('loading-text'),
      continueBtn: doc.getElementById('btn-continue'),
      beginBtn: doc.getElementById('btn-begin'),
      titleActions: doc.getElementById('title-actions'),
      newGameConfirm: doc.getElementById('new-game-confirm'),
      cancelNewGame: doc.getElementById('btn-cancel-new-game'),
      endingLines: doc.getElementById('ending-lines'),
      endingStats: doc.getElementById('ending-stats'),
      quality: doc.getElementById('set-quality'),
      view: doc.getElementById('set-view'),
      sensitivity: doc.getElementById('set-sensitivity'),
      sensitivityValue: doc.getElementById('set-sensitivity-value'),
      fov: doc.getElementById('set-fov'),
      fovValue: doc.getElementById('set-fov-value'),
      aim: doc.getElementById('set-aim'),
      aimCone: doc.getElementById('set-aim-cone'),
      aimConeValue: doc.getElementById('set-aim-cone-value'),
      aimStrength: doc.getElementById('set-aim-strength'),
      aimStrengthValue: doc.getElementById('set-aim-strength-value'),
      volume: doc.getElementById('set-volume'),
      volumeValue: doc.getElementById('set-volume-value'),
      invert: doc.getElementById('set-invert'),
      fps: doc.getElementById('set-fps'),
    };

    this._bind();
    this.applySettings(this.getSettings());
  }

  _on(id, event, fn) {
    const el = this.doc.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  _bind() {
    this._on('btn-begin', 'click', () => {
      if (this.hasSave && this.els.newGameConfirm) {
        this.els.newGameConfirm.classList.remove('hidden');
        if (this.els.titleActions) this.els.titleActions.inert = true;
        this.els.cancelNewGame?.focus();
      } else this.handlers.begin?.();
    });
    this._on('btn-confirm-new-game', 'click', () => {
      this._closeNewGameConfirm(false);
      this.handlers.begin?.();
    });
    this._on('btn-cancel-new-game', 'click', () => this._closeNewGameConfirm());
    this.els.newGameConfirm?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this._closeNewGameConfirm();
      }
    });
    this._on('btn-continue', 'click', () => this.handlers.continueGame?.());
    this._on('btn-settings-title', 'click', () => this.showSettings('title'));
    this._on('btn-resume', 'click', () => this.handlers.resume?.());
    this._on('btn-save', 'click', () => this.handlers.save?.());
    this._on('btn-settings-pause', 'click', () => this.showSettings('pause'));
    this._on('btn-master', 'click', () => this.handlers.master?.());
    this._on('btn-title', 'click', () => this.handlers.title?.());
    this._on('btn-settings-close', 'click', () => this.closeSettings());
    this._on('btn-respawn', 'click', () => this.handlers.respawn?.());
    this._on('btn-continue-explore', 'click', () => this.handlers.continueExplore?.());
    this._on('btn-rematch-1', 'click', () => this.handlers.rematch?.(1));
    this._on('btn-rematch-2', 'click', () => this.handlers.rematch?.(2));
    this._on('btn-rematch-3', 'click', () => this.handlers.rematch?.(3));
    this._on('btn-rematch-cancel', 'click', () => this.handlers.resume?.());

    const update = () => this._emitSettings();
    for (const key of ['quality', 'view', 'invert', 'fps', 'aim']) {
      this.els[key]?.addEventListener('change', update);
    }
    for (const key of ['sensitivity', 'fov', 'aimCone', 'aimStrength', 'volume']) {
      this.els[key]?.addEventListener('input', () => {
        this._syncLabels();
        this._emitSettings();
      });
    }
  }

  _syncLabels() {
    if (this.els.sensitivityValue) this.els.sensitivityValue.textContent = Number(this.els.sensitivity.value).toFixed(1);
    if (this.els.fovValue) this.els.fovValue.textContent = String(Math.round(Number(this.els.fov.value)));
    if (this.els.aimConeValue) this.els.aimConeValue.textContent = `${Math.round(Number(this.els.aimCone.value))}°`;
    if (this.els.aimStrengthValue) this.els.aimStrengthValue.textContent = `${Math.round(Number(this.els.aimStrength.value) * 100)}%`;
    if (this.els.volumeValue) this.els.volumeValue.textContent = `${Math.round(Number(this.els.volume.value) * 100)}%`;
  }

  /** Collect the form into a validated settings object. */
  _readSettings() {
    return normalizeSettings({
      quality: this.els.quality?.value,
      cameraMode: this.els.view?.value,
      sensitivity: Number(this.els.sensitivity?.value),
      fov: Number(this.els.fov?.value),
      aimAssist: Boolean(this.els.aim?.checked),
      aimCone: Number(this.els.aimCone?.value),
      aimStrength: Number(this.els.aimStrength?.value),
      volume: Number(this.els.volume?.value),
      invertY: Boolean(this.els.invert?.checked),
      showFps: Boolean(this.els.fps?.checked),
    });
  }

  _emitSettings() {
    this.onSettingsChange(this._readSettings());
  }

  /** Populate the settings form. */
  applySettings(settings) {
    const s = normalizeSettings(settings);
    if (this.els.quality) {
      // Keep only presets the build actually supports.
      this.els.quality.value = s.quality;
    }
    if (this.els.view) this.els.view.value = s.cameraMode;
    if (this.els.sensitivity) this.els.sensitivity.value = String(s.sensitivity);
    if (this.els.fov) this.els.fov.value = String(s.fov);
    if (this.els.aim) this.els.aim.checked = s.aimAssist;
    if (this.els.aimCone) this.els.aimCone.value = String(s.aimCone);
    if (this.els.aimStrength) this.els.aimStrength.value = String(s.aimStrength);
    if (this.els.volume) this.els.volume.value = String(s.volume);
    if (this.els.invert) this.els.invert.checked = s.invertY;
    if (this.els.fps) this.els.fps.checked = s.showFps;
    this._syncLabels();
    void QUALITY_PRESETS;
  }

  _show(id) {
    const el = this.screens[id];
    if (el) el.classList.remove('hidden');
  }

  _hide(id) {
    const el = this.screens[id];
    if (el) el.classList.add('hidden');
  }

  /** Loading progress 0..1. */
  setLoading(progress, label) {
    if (this.els.loadingFill) this.els.loadingFill.style.width = `${Math.round(progress * 100)}%`;
    if (this.els.loadingText && label) this.els.loadingText.textContent = label;
  }

  hideLoading() {
    this._hide('loading');
  }

  _closeNewGameConfirm(restoreFocus = true) {
    this.els.newGameConfirm?.classList.add('hidden');
    if (this.els.titleActions) this.els.titleActions.inert = false;
    if (restoreFocus) this.els.beginBtn?.focus();
  }

  /** Title screen. */
  showTitle(hasSave = false) {
    this.hasSave = Boolean(hasSave);
    this._closeNewGameConfirm(false);
    this._show('title');
    this.els.continueBtn?.classList.toggle('hidden', !hasSave);
  }

  hideTitle() {
    this._hide('title');
  }

  /** Pause overlay. */
  showPause() {
    this._show('pause');
  }

  hidePause() {
    this._hide('pause');
  }

  /** Settings panel over whichever screen opened it. */
  showSettings(origin = 'pause') {
    this.settingsOrigin = origin;
    this.applySettings(this.getSettings());
    this._show('settings');
  }

  closeSettings() {
    this._hide('settings');
    if (this.settingsOrigin === 'pause') this._show('pause');
    else this._show('title');
  }

  /** Boss rematch / phase-select overlay. */
  showRematch() {
    this._show('rematch');
  }

  hideRematch() {
    this._hide('rematch');
  }

  /** Death overlay. */
  showDeath() {
    this._show('death');
  }

  hideDeath() {
    this._hide('death');
  }

  /**
   * Ending card.
   * @param {{lines:string[], stats:Array<[string,string]>}} data
   */
  showEnding({ lines = [], stats = [] } = {}) {
    if (this.els.endingLines) {
      this.els.endingLines.innerHTML = '';
      for (const line of lines) {
        const p = this.doc.createElement('p');
        p.textContent = line;
        p.style.margin = '0';
        this.els.endingLines.appendChild(p);
      }
    }
    if (this.els.endingStats) {
      this.els.endingStats.innerHTML = '';
      for (const [label, value] of stats) {
        const wrap = this.doc.createElement('div');
        wrap.className = 'ending-stat';
        const b = this.doc.createElement('b');
        b.textContent = value;
        const span = this.doc.createElement('span');
        span.textContent = label;
        wrap.append(b, span);
        this.els.endingStats.appendChild(wrap);
      }
    }
    this._show('ending');
  }

  hideEnding() {
    this._hide('ending');
  }

  /** Is any blocking overlay visible? */
  get overlayOpen() {
    return ['title', 'pause', 'settings', 'death', 'ending', 'rematch'].some(
      (id) => this.screens[id] && !this.screens[id].classList.contains('hidden'),
    );
  }

  /** Is the settings panel the visible one? */
  get settingsOpen() {
    const el = this.screens.settings;
    return Boolean(el && !el.classList.contains('hidden'));
  }

  /** Hide every overlay (used when starting play). */
  hideAll() {
    this._closeNewGameConfirm(false);
    for (const id of ['title', 'pause', 'settings', 'death', 'ending', 'rematch']) this._hide(id);
  }
}
