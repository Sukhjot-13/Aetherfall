/**
 * Story content integrity: every dialogue line points at a real speaker, the
 * Sovereign's intro and victory beats exist, and the ending acknowledges the
 * first-draft boss.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIALOGUES,
  ENDING_LINES,
  SPEAKERS,
  dialogueForShard,
} from '../src/gameplay/story.js';

test('every speaker referenced by a dialogue exists', () => {
  for (const [key, lines] of Object.entries(DIALOGUES)) {
    assert.ok(Array.isArray(lines) && lines.length > 0, `${key} should have lines`);
    for (const line of lines) {
      assert.ok(SPEAKERS[line.speaker], `${key} references unknown speaker ${line.speaker}`);
      assert.equal(typeof line.text, 'string');
      assert.ok(line.text.trim().length > 0, `${key} has an empty line`);
    }
  }
});

test('the Veil Sovereign has an intro and a victory scene', () => {
  assert.equal(SPEAKERS.sovereign.name, 'Vaelor');
  const intro = DIALOGUES.sovereignIntro;
  const victory = DIALOGUES.sovereignVictory;
  assert.ok(intro.length >= 6);
  assert.ok(victory.length >= 4);
  assert.ok(intro.some((line) => line.speaker === 'sovereign'));
  assert.ok(intro.some((line) => line.speaker === 'player'));
  assert.ok(victory.some((line) => line.speaker === 'sovereign'));
  assert.ok(victory.some((line) => line.speaker === 'beacon'));
  assert.match(intro.map((line) => line.text).join(' '), /Vaelor/);
});

test('ending copy acknowledges Vaelor and the restored Beacon', () => {
  const text = ENDING_LINES.join(' ');
  assert.match(text, /Vaelor/);
  assert.match(text, /Beacon/);
  assert.ok(ENDING_LINES.length >= 3);
});

test('shard dialogue lookup falls back safely', () => {
  assert.deepEqual(dialogueForShard('grove'), DIALOGUES.grove);
  assert.deepEqual(dialogueForShard('does-not-exist'), DIALOGUES.grove);
});
