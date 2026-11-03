/**
 * Dialogue box with a typewriter effect. Lines are queued; pressing the
 * interact key completes the current line, then advances.
 */

import { SPEAKERS } from '../gameplay/story.js';

const CHARS_PER_SECOND = 46;

export class Dialogue {
  /** @param {Document} [doc] */
  constructor(doc = document) {
    this.doc = doc;
    this.root = doc.getElementById('dialogue');
    this.speakerEl = doc.getElementById('speaker');
    this.textEl = doc.getElementById('dialogue-text');
    this.advanceEl = doc.querySelector('.dialogue-advance');
    this.skipEl = doc.getElementById('dialogue-skip');

    if (this.skipEl) {
      this.skipEl.addEventListener('click', (event) => {
        event.preventDefault();
        this.skip();
        this.skipEl.blur();
      });
    }

    /** @type {Array<{speaker:string, text:string}>} */
    this.lines = [];
    this.index = 0;
    this.visibleChars = 0;
    this.typing = false;
    this.open = false;
    this.onComplete = null;
    this.onLine = null;
    this.speed = CHARS_PER_SECOND;
  }

  /**
   * Open a dialogue sequence.
   * @param {Array<{speaker:string, text:string}>} lines
   * @param {{onComplete?:Function, onLine?:Function, speed?:number}} [opts]
   */
  show(lines, opts = {}) {
    if (!Array.isArray(lines) || lines.length === 0) return false;
    this.lines = lines;
    this.index = 0;
    this.onComplete = opts.onComplete ?? null;
    this.onLine = opts.onLine ?? null;
    this.speed = opts.speed ?? CHARS_PER_SECOND;
    this.open = true;
    this.root?.classList.remove('hidden');
    this._startLine();
    return true;
  }

  _startLine() {
    const line = this.lines[this.index];
    if (!line) {
      this.close();
      return;
    }
    this.visibleChars = 0;
    this.typing = true;
    this.root?.classList.add('typing');

    const speaker = SPEAKERS[line.speaker] ?? { name: line.speaker, color: '#e8c877' };
    if (this.speakerEl) {
      this.speakerEl.textContent = speaker.name;
      this.speakerEl.style.color = speaker.color;
    }
    if (this.textEl) this.textEl.textContent = '';
    this.onLine?.(line, this.index);
  }

  /** Advance: finish the line, or move to the next one. */
  advance() {
    if (!this.open) return false;
    if (this.typing) {
      const line = this.lines[this.index];
      this.visibleChars = line ? line.text.length : 0;
      this.typing = false;
      this.root?.classList.remove('typing');
      if (this.textEl && line) this.textEl.textContent = line.text;
      return true;
    }
    this.index += 1;
    if (this.index >= this.lines.length) {
      this.close();
      return true;
    }
    this._startLine();
    return true;
  }

  /** Skip the whole conversation (X key / skip button). */
  skip() {
    if (!this.open) return false;
    this.close();
    return true;
  }

  /** Close immediately (Esc / skip). */
  close() {
    this.open = false;
    this.typing = false;
    this.lines = [];
    this.root?.classList.add('hidden');
    this.root?.classList.remove('typing');
    if (this.textEl) this.textEl.textContent = '';
    const done = this.onComplete;
    this.onComplete = null;
    this.onLine = null;
    done?.();
  }

  /** Typewriter tick. */
  update(dt) {
    if (!this.open || !this.typing) return;
    const line = this.lines[this.index];
    if (!line) return;
    this.visibleChars += this.speed * dt;
    const count = Math.min(line.text.length, Math.floor(this.visibleChars));
    if (this.textEl && this.textEl.textContent.length !== count) {
      this.textEl.textContent = line.text.slice(0, count);
    }
    if (count >= line.text.length) {
      this.typing = false;
      this.root?.classList.remove('typing');
    }
  }

  /** Is the box currently on screen? */
  get isOpen() {
    return this.open;
  }

  /** Progress indicator for tests/debug. */
  get progress() {
    return { index: this.index, total: this.lines.length, typing: this.typing };
  }
}
