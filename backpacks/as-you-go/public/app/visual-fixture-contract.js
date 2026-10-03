export const VISUAL_PROFILE = Object.freeze({
  visualProfileVersion: 1,
  window: Object.freeze({ width: 1280, height: 800 }),
  deviceScaleFactor: 1,
  theme: 'light',
  transparency: false,
  animations: 'disabled',
  reducedMotion: false,
  locale: 'en-US',
  fixtureFont: 'Segoe UI',
});

export const VISUAL_FIXTURE_KEYS = Object.freeze([
  'document.root', 'primary-canvas', 'group.fixture-group', 'shortcut.fixture-shortcut',
]);

export function assertFixtureGeometry(observations) {
  const byKey = new Map((Array.isArray(observations) ? observations : []).map((item) => [item.key, item]));
  return VISUAL_FIXTURE_KEYS.map((key) => {
    const item = byKey.get(key);
    const width = Number(item?.boundsCss?.width);
    const height = Number(item?.boundsCss?.height);
    return {
      key,
      visible: item?.visible === true,
      bounded: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0,
    };
  });
}

export function fixtureGeometryPasses(observations) {
  return assertFixtureGeometry(observations).every(({ visible, bounded }) => visible && bounded);
}
