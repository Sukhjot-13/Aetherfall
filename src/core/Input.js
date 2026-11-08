/**
 * Keyboard / mouse input with pointer lock. Tracks held keys, single-frame
 * presses, accumulated mouse deltas and wheel zoom.
 */

const KEY_ACTIONS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'dodge',
  ControlRight: 'dodge',
  Space: 'jump',
  KeyE: 'interact',
  KeyV: 'view',
  KeyM: 'mute',
  KeyX: 'skipDialogue',
  KeyF: 'fly',
  KeyC: 'descend',
  KeyT: 'teleport',
  KeyP: 'photo',
  F1: 'warp1',
  F2: 'warp2',
  F3: 'warp3',
  F4: 'warp4',
  F5: 'warp5',
  F6: 'warp6',
  Backquote: 'master',
  BracketLeft: 'timeBack',
  BracketRight: 'timeForward',
  Escape: 'pause',
  Digit1: 'spell1',
  Digit2: 'spell2',
  Digit3: 'spell3',
  Digit4: 'spell4',
  Digit5: 'spell5',
  Digit6: 'spell6',
  Digit7: 'spell7',
  Digit8: 'spell8',
  Digit9: 'spell9',
  Digit0: 'spell10',
  Numpad1: 'spell1',
  Numpad2: 'spell2',
  Numpad3: 'spell3',
  Numpad4: 'spell4',
  Numpad5: 'spell5',
  Numpad6: 'spell6',
  Numpad7: 'spell7',
  Numpad8: 'spell8',
  Numpad9: 'spell9',
  Numpad0: 'spell10',
};

export class Input {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.downCodes = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.leftDown = false;
    this.onLockChange = null;
    this.onCanvasClick = null;
    this.enabled = true;

    this._onKeyDown = (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      const target = e.target;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      if (!this.down.has(action)) this.pressed.add(action);
      this.downCodes.add(e.code);
      this.down.add(action);
    };
    this._onKeyUp = (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      this.downCodes.delete(e.code);
      if (![...this.downCodes].some((code) => KEY_ACTIONS[code] === action)) this.down.delete(action);
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.leftDown = true;
        if (this.locked) this.pressed.add('cast');
      } else if (e.button === 2) {
        e.preventDefault();
        this.pressed.add('dodge');
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.leftDown = false;
    };
    this._onWheel = (e) => {
      this.wheel += e.deltaY;
      if (this.locked) e.preventDefault();
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.down.clear();
        this.downCodes.clear();
        this.leftDown = false;
      }
      this.onLockChange?.(this.locked);
    };
    this._onClick = () => this.onCanvasClick?.();
    this._onBlur = () => {
      this.down.clear();
      this.downCodes.clear();
      this.pressed.clear();
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.wheel = 0;
      this.leftDown = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    canvas.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  /** Held action? */
  isDown(action) {
    return this.enabled && this.down.has(action);
  }

  /** Pressed this frame? */
  wasPressed(action) {
    return this.enabled && this.pressed.has(action);
  }

  /** Mouse movement accumulated since last frame. */
  consumeMouseDelta() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** Wheel movement since last frame. */
  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Clear single-frame state. Called at the end of every game update. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Request pointer lock (must be called from a user gesture). */
  requestLock() {
    if (this.locked) return Promise.resolve();
    try {
      const result = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      // Both requests can be rejected (for example without a user gesture or
      // inside an embedded browser). Treat that as an unlocked cursor rather
      // than leaving an unhandled promise rejection.
      return result && typeof result.then === 'function'
        ? result.catch(() => this.canvas.requestPointerLock?.()).catch(() => {})
        : Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  }

  /** Release pointer lock. */
  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
