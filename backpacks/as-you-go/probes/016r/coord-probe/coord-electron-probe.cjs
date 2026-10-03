// 016R4 coordinate-truth electron probe (CJS so Electron runs it as main).
// On each marker-file change it logs, at the CURRENT cursor position:
//   electronCursor  - Electron screen.getCursorScreenPoint() (DIP)
//   nearest         - containing display bounds + scaleFactor (DIP space)
//   allDisplays     - every display's bounds + scaleFactor (DIP space)
// Writing 'QUIT' to the marker exits the probe. Ready-marker file is written
// once the app is up so the harness can synchronize.
const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

const marker = process.argv[2];
const ready = process.argv[3];
if (!marker || !ready) {
  console.error('marker and ready paths required');
  app.exit(1);
}

app.whenReady().then(() => {
  fs.writeFileSync(ready, new Date().toISOString());
  let lastSeen = '';
  const timer = setInterval(() => {
    let content = '';
    try {
      content = fs.readFileSync(marker, 'utf8');
    } catch { /* not written yet */ }
    const trimmed = content.trim();
    if (trimmed === 'QUIT') { clearInterval(timer); app.exit(0); }
    if (trimmed && trimmed !== lastSeen) {
      lastSeen = trimmed;
      const pt = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(pt);
      console.log(JSON.stringify({
        label: trimmed,
        electronCursor: { x: pt.x, y: pt.y },
        nearest: {
          scaleFactor: display.scaleFactor,
          bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
          workArea: { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height },
        },
        allDisplays: screen.getAllDisplays().map((d) => ({
          scaleFactor: d.scaleFactor,
          bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
          workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
        })),
      }));
    }
  }, 100);
  const kill = () => { clearInterval(timer); app.exit(0); };
  process.on('SIGTERM', kill);
  process.on('SIGINT', kill);
});
