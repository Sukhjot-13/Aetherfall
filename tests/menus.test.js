import test from 'node:test';
import assert from 'node:assert/strict';
import { Menus } from '../src/ui/Menus.js';

function element() {
  const classes = new Set(['hidden']);
  return {
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name), toggle: (name, force) => force ? classes.add(name) : classes.delete(name) },
    events: {}, style: {}, inert: false, focused: false,
    addEventListener(name, fn) { this.events[name] = fn; },
    focus() { this.focused = true; },
    click() { this.events.click?.(); },
  };
}

test('starting a new game protects an existing save and cancel restores the title controls', () => {
  const ids = ['title', 'title-actions', 'btn-begin', 'btn-continue', 'new-game-confirm', 'btn-confirm-new-game', 'btn-cancel-new-game'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  let starts = 0;
  const menus = new Menus({ doc: { getElementById: (id) => elements[id] ?? null }, handlers: { begin: () => starts++ } });
  menus.showTitle(true);
  elements['btn-begin'].click();
  assert.equal(starts, 0);
  assert.equal(elements['new-game-confirm'].classList.contains('hidden'), false);
  assert.equal(elements['title-actions'].inert, true);
  assert.equal(elements['btn-cancel-new-game'].focused, true);
  elements['btn-cancel-new-game'].click();
  assert.equal(starts, 0);
  assert.equal(elements['new-game-confirm'].classList.contains('hidden'), true);
  assert.equal(elements['title-actions'].inert, false);
  assert.equal(elements['btn-begin'].focused, true);
  elements['btn-begin'].click();
  let prevented = false;
  elements['new-game-confirm'].events.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(elements['new-game-confirm'].classList.contains('hidden'), true);
  elements['btn-begin'].click();
  elements['btn-confirm-new-game'].click();
  assert.equal(starts, 1);
  menus.showTitle(false);
  elements['btn-begin'].click();
  assert.equal(starts, 2);
});
