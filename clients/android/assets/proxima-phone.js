/* Phone-only gestures for Proxima, injected by phone-host.js into the Proxima layer. Proxima's own
 * touch layer (device-view.js) turns a one-finger swipe into proxima:timeline-touch moves; this adds
 * inertia after the finger lifts, strip drag, calendar pinch-zoom and paging, and the viewed PC's palette. */
(function () {
  if (window.__proximaPhone) return;
  window.__proximaPhone = true;

  // A finger is not a mouse: the timeline never sees touch pointers, so a swipe shows no ruler or
  // hover (the phone mouse is the hover). Taps still click; swipes go through touch events.
  for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave'])
    addEventListener(type, (event) => { if (event.pointerType === 'touch' && event.target.closest?.('.exact-timeline')) event.stopImmediatePropagation(); }, true);

  // The date and month strips drag the timeline sideways like the tracks do.
  let stripPan = null;
  addEventListener('touchstart', (event) => {
    const touch = event.touches[0], timeline = event.target.closest?.('.exact-timeline');
    stripPan = event.touches.length === 1 && timeline && event.target.closest('.exact-date-strip,.exact-month-strip') ? { x: touch.clientX, y: touch.clientY, horizontal: null, timeline } : null;
  }, { capture: true, passive: true });
  addEventListener('touchmove', (event) => {
    if (!stripPan || mouseActive() || event.touches.length !== 1) return;
    const touch = event.touches[0], dx = touch.clientX - stripPan.x, dy = touch.clientY - stripPan.y;
    if (stripPan.horizontal === null && Math.hypot(dx, dy) > 8) stripPan.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!stripPan.horizontal) return;
    event.preventDefault();
    stripPan.timeline.dispatchEvent(new CustomEvent('proxima:timeline-touch', { detail: { deltaX: -dx } }));
    stripPan.x = touch.clientX; stripPan.y = touch.clientY;
  }, { capture: true, passive: false });

  // The calendar does not page on a swipe (a swipe there is a pan); device-view.js turns one into a
  // synthetic wheel on the weekday header, which is dropped here. Paging is the edge hitboxes below.
  let paging = false;
  addEventListener('wheel', (event) => {
    if (!event.isTrusted && !paging && event.target.closest?.('.schedule-weekday,.schedule-timed-header')) event.stopImmediatePropagation();
  }, true);
  function page(next) {
    const header = document.querySelector('.schedule-weekday,.schedule-timed-header');
    if (!header) return;
    const box = header.getBoundingClientRect();
    paging = true;
    header.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, deltaY: next ? 100 : -100 }));
    paging = false;
  }
  // Invisible back / next hitboxes at the two ends of the gap between the calendar and the timeline;
  // they glow when tapped.
  const pagers = [];
  function placePagers() {
    const calendar = document.querySelector('#scheduleBody,.schedule-body')?.getBoundingClientRect(), timeline = document.querySelector('.exact-timeline')?.getBoundingClientRect();
    const shown = !!(calendar && timeline && calendar.height && document.querySelector('.schedule-weekday,.schedule-timed-header'));
    for (const pager of pagers) {
      pager.hidden = !shown;
      if (!shown) continue;
      const middle = (calendar.bottom + timeline.top) / 2;
      pager.style.top = `${middle - 36}px`;
      pager.style.left = pager.dataset.edge === 'back' ? '0px' : `${innerWidth - 64}px`;
    }
  }

  // Pinch zooms the calendar physically: its contents scale (CSS zoom, so the scroll area follows)
  // about the point between the fingers. The zoom is remembered on this phone.
  const ZOOM_KEY = 'proxima-phone-calendar-zoom';
  let calendarZoom = 1, calendarPinch = null;
  try { calendarZoom = Math.min(3, Math.max(0.35, Number(localStorage.getItem(ZOOM_KEY)) || 1)); } catch {}
  const calendarBody = () => [...document.querySelectorAll('#scheduleBody')].find((node) => node.getClientRects().length);
  const applyZoom = (body) => body?.style.setProperty('--proxima-phone-zoom', String(calendarZoom));
  addEventListener('touchstart', (event) => {
    const body = event.touches.length === 2 && event.target.closest?.('#scheduleBody');
    if (!body) { if (event.touches.length !== 2) calendarPinch = null; return; }
    const [a, b] = event.touches;
    calendarPinch = { body, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  }, { capture: true, passive: true });
  addEventListener('touchmove', (event) => {
    if (!calendarPinch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = event.touches, distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!(distance > 0 && calendarPinch.distance > 0)) return;
    const body = calendarPinch.body, box = body.getBoundingClientRect();
    const x = (a.clientX + b.clientX) / 2 - box.left, y = (a.clientY + b.clientY) / 2 - box.top;
    const next = Math.min(3, Math.max(0.35, calendarZoom * distance / calendarPinch.distance));
    const contentX = (body.scrollLeft + x) / calendarZoom, contentY = (body.scrollTop + y) / calendarZoom;
    calendarZoom = next; applyZoom(body);
    body.scrollLeft = contentX * next - x; body.scrollTop = contentY * next - y;
    calendarPinch.distance = distance;
  }, { capture: true, passive: false });
  addEventListener('touchend', (event) => {
    if (!calendarPinch || event.touches.length >= 2) return;
    calendarPinch = null;
    try { localStorage.setItem(ZOOM_KEY, String(calendarZoom)); } catch {}
  }, { capture: true, passive: true });
  // The calendar re-renders its contents; the zoom lives on the body, so it survives that.
  setInterval(() => applyZoom(calendarBody()), 500);

  // Inertia: the swipe's last ~100 ms of movement carries on after lift-off and decays.
  let samples = [], pinched = false, glide = 0, gliding = false;
  const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };
  addEventListener('proxima:timeline-touch', (event) => {
    if (gliding) return;
    const { deltaX, factor } = event.detail || {};
    if (factor !== undefined && factor !== 1) { pinched = true; return; }
    if (Number.isFinite(deltaX)) samples.push({ at: performance.now(), deltaX, target: event.target });
  }, true);
  addEventListener('touchstart', (event) => {
    stopGlide();
    if (event.touches.length === 1) { samples = []; pinched = false; } else pinched = true;
  }, { capture: true, passive: true });
  addEventListener('touchend', (event) => {
    if (event.touches.length || pinched || mouseActive()) return;
    const now = performance.now(), recent = samples.filter((sample) => now - sample.at < 100);
    samples = [];
    if (recent.length < 2 || now - recent.at(-1).at > 60) return;
    const span = Math.max(16, now - recent[0].at);
    let velocity = recent.reduce((sum, sample) => sum + sample.deltaX, 0) / span; // px per ms
    if (Math.abs(velocity) < 0.15) return;
    const target = recent.at(-1).target;
    let last = now;
    const step = (time) => {
      const elapsed = Math.min(48, time - last); last = time;
      gliding = true;
      target.dispatchEvent(new CustomEvent('proxima:timeline-touch', { detail: { deltaX: velocity * elapsed } }));
      gliding = false;
      velocity *= Math.exp(-elapsed / 325);
      glide = Math.abs(velocity) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }, { capture: true, passive: true });

  // The cursor / mouse (hold or tap the arrow button) is phone-mouse.js, shared with As you Go.
  const mouseActive = () => window.__phoneMouse?.active() === true;
  const style = document.createElement('style');
  style.textContent = `
#scheduleBody{touch-action:pan-x pan-y}
#scheduleBody>*{zoom:var(--proxima-phone-zoom,1)}
.proxima-phone-pager{position:fixed;z-index:3980;width:64px;height:72px;touch-action:none;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent,#8ddcff) 55%,transparent),transparent);opacity:0}
.proxima-phone-pager[hidden]{display:none}
.proxima-phone-pager.is-lit{animation:proxima-phone-pager-lit 420ms ease-out}
@keyframes proxima-phone-pager-lit{0%{opacity:.9}100%{opacity:0}}
html body button.proxima-phone-history{position:fixed;bottom:16px;z-index:2147483600;width:52px;height:52px;border-radius:50%;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:var(--panel,#1f252b);color:var(--ink,#e6e9ef);box-shadow:0 6px 18px #0006;touch-action:none;display:grid;place-items:center;padding:0;opacity:.5}
html body button.proxima-phone-history svg{width:22px;height:22px;pointer-events:none}
html body:has(.blob-workspace-pane:not([hidden])) button.proxima-phone-history{display:none}
html body button.proxima-phone-history.is-pressed{opacity:1;background:color-mix(in srgb,var(--panel,#1f252b) 60%,var(--accent,#8ddcff))}`;

  // Each PC keeps its own palette wherever it is viewed (SlopTop blue, LapDog green); the phone shows
  // the viewed PC's, chosen by Proxima's own device-theme.js from that PC's durable owner identity.
  const ownerId = new URL(location.href).searchParams.get('papers-device');
  // The phone may know a PC by another id than Proxima's table, so the PC's name (set once its
  // snapshot loads) is passed too; the palette is applied again whenever that name changes.
  if (ownerId) import(new URL('device-theme.js?v=one-palette', location.href).href).then(({ applyDeviceTheme }) => {
    const apply = () => applyDeviceTheme(document, { id: ownerId, name: document.documentElement.dataset.device || '' });
    apply();
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-device'] });
  }).catch(() => {});
  // The phone's own Proxima: device-theme.js gives every device the same palette.
  else import(new URL('device-theme.js?v=one-palette', location.href).href).then(({ applyDeviceTheme }) => applyDeviceTheme(document, { id: 'local', kind: 'phone' })).catch(() => {});

  // Undo / redo at the bottom right: the same Z / Y the PC's keyboard sends (the owner applies them).
  function historyButtons() {
    const icon = (redo) => `<svg viewBox="0 0 24 24" aria-hidden="true"${redo ? ' style="transform:scaleX(-1)"' : ''}><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    for (const [key, label, right] of [['z', 'Undo', 78], ['y', 'Redo', 16]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'proxima-phone-history'; button.title = label; button.setAttribute('aria-label', label);
      button.innerHTML = icon(key === 'y'); button.style.right = right + 'px';
      button.addEventListener('touchstart', (event) => { event.preventDefault(); event.stopPropagation(); button.classList.add('is-pressed'); }, { passive: false });
      button.addEventListener('touchend', (event) => {
        event.preventDefault(); event.stopPropagation(); button.classList.remove('is-pressed');
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Key' + key.toUpperCase(), bubbles: true, cancelable: true }));
      }, { passive: false });
      button.addEventListener('touchcancel', () => button.classList.remove('is-pressed'));
      document.body.append(button);
    }
  }

  const install = () => {
    document.head.append(style);
    historyButtons();
    for (const edge of ['back', 'next']) {
      const pager = document.createElement('div');
      pager.className = 'proxima-phone-pager'; pager.dataset.edge = edge; pager.hidden = true;
      pager.addEventListener('touchstart', (event) => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
      pager.addEventListener('touchend', (event) => {
        event.preventDefault(); event.stopPropagation();
        page(edge === 'next');
        pager.classList.remove('is-lit'); void pager.offsetWidth; pager.classList.add('is-lit');
      }, { passive: false });
      pager.addEventListener('click', () => page(edge === 'next'));
      pagers.push(pager); document.body.append(pager);
    }
    placePagers();
    new ResizeObserver(placePagers).observe(document.documentElement);
    addEventListener('scroll', placePagers, { capture: true, passive: true });
    setInterval(placePagers, 500);
  };
  if (document.body) install(); else addEventListener('DOMContentLoaded', install, { once: true });
})();
