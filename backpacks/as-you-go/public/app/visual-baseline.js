import { createHash } from 'node:crypto';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function baselineUpdateEnabled(env = {}) {
  return env.UPDATE_VISUAL_BASELINES === '1';
}

export function validateBaselineManifest(manifest, profile) {
  return Boolean(manifest
    && manifest.fixtureId === 'as-you-go-non-empty-v1'
    && manifest.captureTarget === 'surface'
    && manifest.visualProfileVersion === profile.visualProfileVersion
    && manifest.dimensions?.width === profile.window.width
    && manifest.dimensions?.height === profile.window.height
    && typeof manifest.pngSha256 === 'string'
    && manifest.pngSha256.length === 64);
}
