/**
 * Player settings: graphics quality, sensitivity, audio and camera preference.
 * Persisted separately from the save slot so settings survive a new game.
 */

export const SETTINGS_KEY = 'aetherfall.settings.v1';

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low',
    label: 'Low',
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadows: true,
    bloom: false,
    grassCount: 8000,
    treeCount: 760,
    waterSegments: 72,
    terrainDetail: 0.5,
  }),
  medium: Object.freeze({
    id: 'medium',
    label: 'Medium',
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    shadows: true,
    bloom: true,
    grassCount: 18000,
    treeCount: 1500,
    waterSegments: 110,
    terrainDetail: 0.8,
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    pixelRatio: 1.75,
    shadowMapSize: 2048,
    shadows: true,
    bloom: true,
    grassCount: 32000,
    treeCount: 2400,
    waterSegments: 150,
    terrainDetail: 1,
  }),
  ultra: Object.freeze({
    id: 'ultra',
    label: 'Ultra',
    pixelRatio: 2,
    shadowMapSize: 4096,
    shadows: true,
    bloom: true,
    grassCount: 46000,
    treeCount: 3600,
    waterSegments: 190,
    terrainDetail: 1,
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'high',
  sensitivity: 1,
  invertY: false,
  fov: 72,
  volume: 0.7,
  cameraMode: 'third',
  showFps: false,
  aimAssist: true,
  aimCone: 18,
  aimStrength: 1,
});

/** Merge arbitrary input with defaults, clamping and validating. */
export function normalizeSettings(raw = {}) {
  const quality = Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, raw.quality)
    ? raw.quality
    : DEFAULT_SETTINGS.quality;
  const sensitivity = Number.isFinite(raw.sensitivity)
    ? Math.min(3, Math.max(0.2, raw.sensitivity))
    : DEFAULT_SETTINGS.sensitivity;
  const fov = Number.isFinite(raw.fov) ? Math.min(100, Math.max(55, raw.fov)) : DEFAULT_SETTINGS.fov;
  const volume = Number.isFinite(raw.volume)
    ? Math.min(1, Math.max(0, raw.volume))
    : DEFAULT_SETTINGS.volume;
  const aimCone = Number.isFinite(raw.aimCone)
    ? Math.min(45, Math.max(2, raw.aimCone))
    : DEFAULT_SETTINGS.aimCone;
  const aimStrength = Number.isFinite(raw.aimStrength)
    ? Math.min(1.5, Math.max(0, raw.aimStrength))
    : DEFAULT_SETTINGS.aimStrength;
  return {
    quality,
    sensitivity,
    invertY: Boolean(raw.invertY),
    fov,
    volume,
    cameraMode: raw.cameraMode === 'first' ? 'first' : 'third',
    showFps: Boolean(raw.showFps),
    aimAssist: raw.aimAssist === undefined ? DEFAULT_SETTINGS.aimAssist : Boolean(raw.aimAssist),
    aimCone,
    aimStrength,
  };
}

/** Quality preset for the current settings. */
export function qualityPreset(settings) {
  return QUALITY_PRESETS[settings?.quality] ?? QUALITY_PRESETS.high;
}

/** Read settings from storage, falling back to defaults. */
export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings. Returns true on success. */
export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
