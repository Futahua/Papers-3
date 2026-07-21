'use strict';

// Ensure the packed Papers.exe carries the custom app icon.
//
// A full NSIS build already rcedits win.icon into the exe, but a `--dir` pack can
// skip that step and ship the stock Electron atom icon. This afterPack hook embeds
// build/icon.ico into the freshly packed exe on every path (idempotent), using the
// rcedit shipped with app-builder-lib / electron-winstaller — no extra dependency.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function findRcedit(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
    path.join(projectRoot, 'node_modules', 'app-builder-lib', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
    path.join(projectRoot, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

exports.default = async function afterPack(context) {
  // Windows only.
  if (context.electronPlatformName !== 'win32') return;

  const projectRoot = context.packager.info.projectDir;
  const ico = path.join(projectRoot, 'build', 'icon.ico');
  if (!fs.existsSync(ico)) {
    console.warn('[afterPack] build/icon.ico missing — skipping icon embed');
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exe = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exe)) {
    console.warn(`[afterPack] ${exeName} not found in ${context.appOutDir} — skipping icon embed`);
    return;
  }

  const rcedit = findRcedit(projectRoot);
  if (!rcedit) {
    console.warn('[afterPack] rcedit.exe not found — skipping icon embed');
    return;
  }

  try {
    execFileSync(rcedit, [exe, '--set-icon', ico], { stdio: 'inherit' });
    console.log(`[afterPack] embedded ${ico} into ${exe}`);
  } catch (err) {
    console.warn(`[afterPack] failed to embed icon: ${err.message}`);
  }
};
