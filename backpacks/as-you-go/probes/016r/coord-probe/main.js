// 016R coordinate-space measurement probe (Electron side).
// Launched with the SAME electron binary as Papers, with an isolated
// user-data-dir. For every marker-file change it logs, at the CURRENT
// cursor position: Electron screen.getCursorScreenPoint() (DIP), the
// containing display bounds and scaleFactor, and all displays' bounds +
// scale factors. The harness moves the native cursor between markers.
const fs = require('node:fs');
const { app, screen } = require('electron');

const marker = process.argv[2];
if (!marker) {
  console.error('marker path required');
  app.exit(1);
}

app.whenReady().then(() => {
  let lastSeen = '';
  const timer = setInterval(() => {
    let content = '';
    try {
      content = fs.readFileSync(marker, 'utf8');
    } catch { /* not written yet */ }
    if (content && content.trim() !== lastSeen) {
      lastSeen = content.trim();
      const pt = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(pt);
      const payload = {
        label: lastSeen,
        electronCursor: { x: pt.x, y: pt.y },
        nearest: {
          scaleFactor: display.scaleFactor,
          bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
        },
        allDisplays: screen.getAllDisplays().map((d) => ({
          scaleFactor: d.scaleFactor,
          bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
        })),
      };
      console.log(JSON.stringify(payload));
    }
  }, 120);
  const kill = () => { clearInterval(timer); app.exit(0); };
  process.on('SIGTERM', kill);
  process.on('SIGINT', kill);
});
