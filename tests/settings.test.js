import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  QUALITY_PRESETS,
  qualityPreset,
  saveSettings,
} from '../src/core/settings.js';

test('defaults are valid and high quality', () => {
  assert.equal(DEFAULT_SETTINGS.quality, 'high');
  assert.equal(DEFAULT_SETTINGS.cameraMode, 'third');
  assert.ok(QUALITY_PRESETS.high.grassCount > QUALITY_PRESETS.low.grassCount);
});

test('normalize clamps numeric settings', () => {
  const s = normalizeSettings({
    quality: 'ultra',
    sensitivity: 99,
    fov: 10,
    volume: -4,
    invertY: 1,
    cameraMode: 'first',
  });
  assert.equal(s.quality, 'ultra');
  assert.equal(s.sensitivity, 3);
  assert.equal(s.fov, 55);
  assert.equal(s.volume, 0);
  assert.equal(s.invertY, true);
  assert.equal(s.cameraMode, 'first');
});

test('aim settings default and clamp', () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.aimAssist, true);
  assert.equal(defaults.aimCone, 18);
  assert.equal(defaults.aimStrength, 1);
  const clamped = normalizeSettings({ aimAssist: false, aimCone: 999, aimStrength: -1 });
  assert.equal(clamped.aimAssist, false);
  assert.equal(clamped.aimCone, 45);
  assert.equal(clamped.aimStrength, 0);
});

test('normalize rejects unknown quality', () => {
  assert.equal(normalizeSettings({ quality: 'cinematic' }).quality, 'high');
});

test('normalize rejects unknown camera modes', () => {
  assert.equal(normalizeSettings({ cameraMode: 'sideways' }).cameraMode, 'third');
});

test('quality preset resolves', () => {
  assert.equal(qualityPreset({ quality: 'medium' }).id, 'medium');
  assert.equal(qualityPreset({ quality: 'nope' }).id, 'high');
});

test('settings round-trip through storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  saveSettings({ ...DEFAULT_SETTINGS, sensitivity: 2, quality: 'low' }, storage);
  const loaded = loadSettings(storage);
  assert.equal(loaded.sensitivity, 2);
  assert.equal(loaded.quality, 'low');
});

test('corrupt settings fall back to defaults', () => {
  const storage = { getItem: () => '{bad' };
  assert.deepEqual(loadSettings(storage), { ...DEFAULT_SETTINGS });
});

test('every quality preset is strictly richer than the one below it', () => {
  const order = ['low', 'medium', 'high', 'ultra'];
  for (let i = 1; i < order.length; i++) {
    const prev = QUALITY_PRESETS[order[i - 1]];
    const next = QUALITY_PRESETS[order[i]];
    assert.ok(next.grassCount > prev.grassCount, `${order[i]} grass must exceed ${order[i - 1]}`);
    assert.ok(next.treeCount > prev.treeCount, `${order[i]} trees must exceed ${order[i - 1]}`);
    assert.ok(next.waterSegments >= prev.waterSegments);
    assert.ok(next.shadowMapSize >= prev.shadowMapSize);
  }
});

test('grass and tree counts stay within a sane draw budget', () => {
  for (const preset of Object.values(QUALITY_PRESETS)) {
    assert.ok(preset.grassCount >= 6000, `${preset.id} needs enough grass to read as a meadow`);
    assert.ok(preset.grassCount <= 60000, `${preset.id} grass count exceeds the instance budget`);
    assert.ok(preset.treeCount >= 500, `${preset.id} needs a visible forest`);
    assert.ok(preset.treeCount <= 4000, `${preset.id} tree count exceeds the instance budget`);
  }
});
