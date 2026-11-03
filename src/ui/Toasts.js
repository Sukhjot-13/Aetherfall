/**
 * Transient notification pills. Capped in number and self-cleaning.
 */

export class Toasts {
  /** @param {Document} [doc] */
  constructor(doc = document) {
    this.doc = doc;
    this.root = doc.getElementById('toasts');
    this.max = 4;
    /** @type {HTMLElement[]} */
    this.items = [];
  }

  /**
   * @param {string} text
   * @param {'gold'|'mint'|'warn'|''} [kind]
   * @param {number} [duration]
   */
  push(text, kind = '', duration = 3200) {
    if (!this.root || !text) return null;
    while (this.items.length >= this.max) {
      const oldest = this.items.shift();
      oldest?.remove();
    }
    const el = this.doc.createElement('div');
    el.className = `toast ${kind}`.trim();
    el.textContent = text;
    this.root.appendChild(el);
    this.items.push(el);
    const timer = setTimeout(() => {
      el.remove();
      this.items = this.items.filter((item) => item !== el);
    }, duration);
    el.dataset.timer = String(timer);
    return el;
  }

  /** Remove every toast. */
  clear() {
    for (const el of this.items) el.remove();
    this.items = [];
  }
}
