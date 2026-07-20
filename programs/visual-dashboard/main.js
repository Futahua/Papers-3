/**
 * Visual Dashboard — isolation proof program (plan section 21).
 * Reads ONLY the summary Repository Research explicitly publishes; renders it
 * with Canvas 2D in a deliberately different visual language; persists its own
 * preferences; requests no filesystem or machine capability.
 */
const papers = window.papers;

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const ctx = stage.getContext('2d');

let identity = null;
let prefs = { schemaVersion: 1, hue: 188, lastSummary: null, lastLoadedAt: null };
let summary = null;

function resize() {
  const ratio = window.devicePixelRatio || 1;
  stage.width = Math.floor(window.innerWidth * ratio);
  stage.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function neon(alpha = 1, hueShift = 0) {
  return `hsla(${(prefs.hue + hueShift) % 360}, 95%, 65%, ${alpha})`;
}

function drawGrid(w, h) {
  ctx.strokeStyle = neon(0.07);
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawBars(w, h) {
  const counts = summary?.counts ?? {};
  const entries = [
    ['NOTES', counts.notes ?? 0],
    ['EVIDENCE', counts.evidence ?? 0],
    ['TOPICS', counts.topics ?? 0],
    ['TASKS', counts.tasks ?? 0],
    ['DRAFTS', counts.drafts ?? 0],
    ['ARTIFACTS', counts.artifacts ?? 0],
  ];
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const barWidth = Math.min(90, (w - 160) / entries.length - 24);
  const baseY = h - 90;
  const chartHeight = Math.min(h * 0.45, 340);

  entries.forEach(([label, value], i) => {
    const x = 90 + i * (barWidth + 34);
    const height = (value / max) * chartHeight;
    const gradient = ctx.createLinearGradient(0, baseY - height, 0, baseY);
    gradient.addColorStop(0, neon(0.95, i * 24));
    gradient.addColorStop(1, neon(0.15, i * 24));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, baseY - height, barWidth, height);
    ctx.strokeStyle = neon(0.9, i * 24);
    ctx.strokeRect(x, baseY - height, barWidth, height);

    ctx.fillStyle = neon(0.9, i * 24);
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barWidth / 2, baseY + 18);
    ctx.font = 'bold 16px Consolas, monospace';
    ctx.fillText(String(value), x + barWidth / 2, baseY - height - 8);
  });
}

function drawTopicRing(w, h) {
  const topics = summary?.topics ?? [];
  if (topics.length === 0) return;
  const cx = w - Math.min(w * 0.2, 220);
  const cy = Math.min(h * 0.32, 240);
  const radius = Math.min(120, w * 0.1);
  const total = Math.max(1, topics.reduce((acc, t) => acc + (t.evidenceCount ?? 0), 0));
  let angle = -Math.PI / 2;
  topics.forEach((topic, i) => {
    const share = (topic.evidenceCount ?? 0) / total;
    const sweep = Math.max(0.08, share * Math.PI * 2);
    ctx.beginPath();
    ctx.strokeStyle = neon(0.9, i * 40);
    ctx.lineWidth = 16;
    ctx.arc(cx, cy, radius, angle, angle + sweep - 0.05);
    ctx.stroke();
    angle += sweep;
  });
  ctx.fillStyle = neon(0.95);
  ctx.font = '12px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${topics.length} TOPICS`, cx, cy + 4);
}

function drawTaskFlow(w, h) {
  const byStatus = summary?.tasksByStatus ?? {};
  const lanes = ['proposed', 'approved', 'delegated', 'review', 'accepted', 'rejected'];
  const y = 70;
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'left';
  lanes.forEach((lane, i) => {
    const x = 90 + i * Math.min(130, (w - 200) / lanes.length);
    const value = byStatus[lane] ?? 0;
    ctx.fillStyle = value > 0 ? neon(0.95, 300) : neon(0.25);
    ctx.beginPath();
    ctx.arc(x, y, 6 + Math.min(14, value * 4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = neon(0.6);
    ctx.fillText(`${lane.toUpperCase()} ${value}`, x - 18, y + 30);
    if (i < lanes.length - 1) {
      ctx.strokeStyle = neon(0.25);
      ctx.beginPath();
      ctx.moveTo(x + 22, y);
      ctx.lineTo(x + Math.min(130, (w - 200) / lanes.length) - 22, y);
      ctx.stroke();
    }
  });
}

function draw() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  drawGrid(w, h);
  if (!summary) {
    ctx.fillStyle = neon(0.5);
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO SIGNAL — LOAD SUMMARY', w / 2, h / 2);
    return;
  }
  drawTaskFlow(w, h);
  drawBars(w, h);
  drawTopicRing(w, h);
  const repos = (summary.repositories ?? []).map((r) => r.name).join(' · ');
  ctx.fillStyle = neon(0.65);
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(
    `SRC ${repos || '(none)'} — PUBLISHED ${summary.updatedAt ?? '?'}`,
    w - 16,
    h - 14,
  );
}

async function persist() {
  try {
    await papers.state.save(prefs);
  } catch {
    // preference loss is acceptable; never crash the dashboard
  }
}

async function loadSummary() {
  statusEl.textContent = 'requesting shared summary…';
  try {
    const result = await papers.capabilities.request({
      invocationId: crypto.randomUUID(),
      backpackId: identity.backpackId,
      programId: identity.programId,
      capability: 'program.read-shared-summary',
      arguments: { sourceProgramId: 'repository-research' },
      reason: 'Render the research dashboard from explicitly shared summary data',
    });
    summary = result?.summary ?? null;
    prefs.lastSummary = summary;
    prefs.lastLoadedAt = new Date().toISOString();
    await persist();
    statusEl.textContent = summary
      ? `summary loaded ${prefs.lastLoadedAt}`
      : 'repository-research has not published a summary yet';
  } catch (err) {
    const message = String(err?.message ?? err);
    const marker = 'capability-error:';
    const idx = message.indexOf(marker);
    if (idx >= 0) {
      try {
        statusEl.textContent = `denied: ${JSON.parse(message.slice(idx + marker.length)).message}`;
      } catch {
        statusEl.textContent = message.slice(0, 140);
      }
    } else {
      statusEl.textContent = message.slice(0, 140);
    }
  }
  draw();
}

async function init() {
  identity = await papers.identity();
  const loaded = await papers.state.load();
  if (loaded && typeof loaded === 'object' && loaded.schemaVersion === 1) {
    prefs = { ...prefs, ...loaded };
    summary = prefs.lastSummary ?? null;
    if (summary) statusEl.textContent = `cached summary from ${prefs.lastLoadedAt ?? '?'}`;
  }

  document.getElementById('load').addEventListener('click', loadSummary);
  document.getElementById('hue').addEventListener('click', async () => {
    prefs.hue = (prefs.hue + 47) % 360;
    await persist();
    draw();
  });

  await papers.commands.register([
    { id: 'vd.refresh', label: 'Refresh dashboard', description: 'Reload the shared summary' },
  ]);
  await papers.shelf.contribute([
    { id: 'vd-refresh', label: 'Refresh', commandId: 'vd.refresh', title: 'Reload shared summary' },
  ]);
  papers.events.onCommand(({ commandId }) => {
    if (commandId === 'vd.refresh') void loadSummary();
  });

  window.addEventListener('resize', resize);
  resize();
}

init().catch((err) => {
  statusEl.textContent = `failed to start: ${String(err).slice(0, 160)}`;
});
