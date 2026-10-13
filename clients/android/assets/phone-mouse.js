/* The phone's mouse, injected by phone-host.js into As you Go and every layer (Proxima, a device's
 * As you Go). The round arrow button at the bottom left:
 *  - held: cursor mode while held. The view freezes, a second finger moves the cursor like a
 *    trackpad, the page gets the pointer moves a mouse gives (hover), a quick tap of that finger clicks.
 *  - tapped: mouse mode until tapped again. L, M and R buttons appear around it; one finger moves the
 *    cursor (a quick tap is a left click), two fingers scroll at the cursor, and L/M/R press and
 *    release like real mouse buttons (holding L while moving drags, R opens context menus, two quick
 *    L clicks are a double click).
 * The page only ever sees the mouse and pointer events a PC's mouse would send. */
(function () {
  if (window.__phoneMouse) return;
  const HOLD_MS = 200, TAP_TRAVEL = 10, TAP_MS = 300, DOUBLE_MS = 400;
  let mode = 'off', cursor = null, hovered = null, buttonsDown = 0, lastClick = null;
  const api = { active: () => mode !== 'off' };
  window.__phoneMouse = api;

  const style = document.createElement('style');
  style.textContent = `
html body button.phone-mouse-button{position:fixed;z-index:2147483600;width:52px;height:52px;border-radius:50%;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:var(--panel,#1f252b);color:var(--ink,#e6e9ef);box-shadow:0 6px 18px #0006;touch-action:none;display:grid;place-items:center;padding:0;font:600 17px/1 system-ui,sans-serif;opacity:.85;-webkit-user-select:none;user-select:none}
html body button.phone-mouse-button svg{width:22px;height:22px;pointer-events:none}
html body button.phone-mouse-button.is-on{opacity:1;outline:2px solid color-mix(in srgb,currentColor 60%,transparent)}
html body button.phone-mouse-button.is-pressed{background:color-mix(in srgb,var(--panel,#1f252b) 60%,var(--accent,#8ddcff));opacity:1}
html body button.phone-mouse-button[hidden]{display:none}
.phone-mouse-shield{position:fixed;inset:0;z-index:2147483500;touch-action:none;background:transparent}
.phone-mouse-cursor{position:fixed;left:0;top:0;z-index:2147483550;width:20px;height:20px;pointer-events:none;will-change:transform}`;
  const arrow = '<svg viewBox="0 0 20 20"><path d="M2 1.5v15.2l4.1-3.9 2.7 6 2.6-1.1-2.7-5.9h5.7z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const OURS = '.phone-mouse-shield,.phone-mouse-cursor,.phone-mouse-button';

  // A synthetic pointer cannot set :hover, so the page's :hover rules are mirrored onto a class the
  // cursor puts on what it is over (Proxima's row arrows, for one, only show while hovered).
  function mirrorHover() {
    const copies = [];
    const walk = (rules, wrap) => {
      for (const rule of rules) {
        if (rule.cssRules && rule.conditionText !== undefined) { walk(rule.cssRules, (text) => wrap(`${rule instanceof CSSMediaRule ? '@media' : '@supports'} ${rule.conditionText}{${text}}`)); continue; }
        if (rule.selectorText?.includes(':hover')) copies.push(wrap(rule.cssText.replace(rule.selectorText, rule.selectorText.replaceAll(':hover', '.phone-mouse-hover'))));
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, (text) => text); } catch {} }
    const mirrored = document.createElement('style'); mirrored.textContent = copies.join('\n'); document.head.append(mirrored);
  }
  const markHover = (node, on) => { for (; node; node = node.parentElement) node.classList.toggle('phone-mouse-hover', on); };
  const chain = (node) => { const list = []; for (; node; node = node.parentElement) list.push(node); return list; };
  const at = (x, y) => document.elementsFromPoint(x, y).find((node) => !node.closest(OURS)) || null;
  const init = (x, y, extra) => ({ bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window, buttons: buttonsDown, ...extra });
  const POINTER_ID = 9001; // never a real finger's id
  const pointer = (type, target, x, y, extra = {}, bubbles = true) => target.dispatchEvent(new PointerEvent(type, { ...init(x, y, extra), bubbles, cancelable: bubbles, pointerId: POINTER_ID, pointerType: 'mouse', isPrimary: true }));

  // Pointer capture, as a real mouse has it: a drag handler that captures the pointer gets every move
  // and the release even after the cursor leaves it (blob drags would otherwise stall at the blob's
  // edge and keep dragging on the next hover). The browser has no real pointer for these events, so
  // capture of this pointer is kept here.
  let captured = null;
  const loseCapture = () => { if (!captured) return; const was = captured; captured = null; was.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: POINTER_ID, pointerType: 'mouse', isPrimary: true })); };
  const proto = Element.prototype, native = { set: proto.setPointerCapture, release: proto.releasePointerCapture, has: proto.hasPointerCapture };
  proto.setPointerCapture = function (id) {
    if (id !== POINTER_ID) return native.set.call(this, id);
    if (captured === this) return;
    loseCapture(); captured = this;
    this.dispatchEvent(new PointerEvent('gotpointercapture', { bubbles: true, pointerId: POINTER_ID, pointerType: 'mouse', isPrimary: true }));
  };
  proto.releasePointerCapture = function (id) { if (id !== POINTER_ID) return native.release.call(this, id); if (captured === this) loseCapture(); };
  proto.hasPointerCapture = function (id) { return id === POINTER_ID ? captured === this : native.has.call(this, id); };
  const mouse = (type, target, x, y, extra = {}) => target.dispatchEvent(new MouseEvent(type, init(x, y, extra)));

  function hover(x, y) {
    const target = at(x, y);
    if (target !== hovered) {
      const before = chain(hovered), after = chain(target);
      if (hovered) { pointer('pointerout', hovered, x, y); mouse('mouseout', hovered, x, y); for (const node of before) if (!after.includes(node)) { pointer('pointerleave', node, x, y, {}, false); node.dispatchEvent(new MouseEvent('mouseleave', { ...init(x, y), bubbles: false })); } }
      if (target) { pointer('pointerover', target, x, y); mouse('mouseover', target, x, y); for (const node of after.reverse()) if (!before.includes(node)) { pointer('pointerenter', node, x, y, {}, false); node.dispatchEvent(new MouseEvent('mouseenter', { ...init(x, y), bubbles: false })); } }
      markHover(hovered, false); markHover(target, true);
      hovered = target;
    }
    if (captured) pointer('pointermove', captured, x, y); else if (target) pointer('pointermove', target, x, y);
    if (target) mouse('mousemove', target, x, y);
  }
  function leave() {
    if (!hovered) return;
    pointer('pointerout', hovered, -1, -1);
    for (const node of chain(hovered)) pointer('pointerleave', node, -1, -1, {}, false);
    markHover(hovered, false); hovered = null;
  }

  // Mouse buttons: 0 left, 1 middle, 2 right (the `buttons` bits are 1, 4, 2).
  const BIT = [1, 4, 2];
  let pressTarget = [null, null, null];
  function press(button) {
    if (!cursor) return;
    hover(cursor.x, cursor.y);
    const target = hovered; if (!target) return;
    buttonsDown |= BIT[button]; pressTarget[button] = target;
    pointer('pointerdown', target, cursor.x, cursor.y, { button });
    const proceed = mouse('mousedown', target, cursor.x, cursor.y, { button });
    if (button === 0 && proceed) {
      const focusable = target.closest('input,textarea,select,button,a[href],[contenteditable="true"],[tabindex]');
      if (focusable && document.activeElement !== focusable) focusable.focus({ preventScroll: true });
      else if (!focusable && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }
  }
  function release(button) {
    if (!cursor || !(buttonsDown & BIT[button])) return;
    buttonsDown &= ~BIT[button];
    hover(cursor.x, cursor.y);
    const target = hovered || pressTarget[button]; if (!target) { loseCapture(); return; }
    pointer('pointerup', captured || target, cursor.x, cursor.y, { button });
    if (!buttonsDown) loseCapture();
    mouse('mouseup', target, cursor.x, cursor.y, { button });
    const same = pressTarget[button] && (pressTarget[button] === target || pressTarget[button].contains(target) || target.contains(pressTarget[button]));
    pressTarget[button] = null;
    if (button === 2) { mouse('contextmenu', target, cursor.x, cursor.y, { button }); return; }
    if (!same) return;
    if (button === 1) { mouse('auxclick', target, cursor.x, cursor.y, { button }); return; }
    const now = performance.now(), double = lastClick && now - lastClick.at < DOUBLE_MS && Math.hypot(cursor.x - lastClick.x, cursor.y - lastClick.y) < 8;
    mouse('click', target, cursor.x, cursor.y, { button, detail: double ? 2 : 1 });
    if (double) { mouse('dblclick', target, cursor.x, cursor.y, { button, detail: 2 }); lastClick = null; }
    else lastClick = { at: now, x: cursor.x, y: cursor.y };
  }
  const clickAt = () => { press(0); release(0); };
  function wheel(dx, dy) {
    const target = cursor && at(cursor.x, cursor.y); if (!target) return;
    target.dispatchEvent(new WheelEvent('wheel', { ...init(cursor.x, cursor.y), deltaX: dx, deltaY: dy, deltaMode: 0 }));
  }

  // Cursor, shield and the L/M/R buttons.
  let main = null; const extras = [];
  function place() { cursor.node.style.transform = `translate(${cursor.x - 2}px,${cursor.y - 1.5}px)`; hover(cursor.x, cursor.y); }
  function show(next) {
    if (!cursor) {
      const shield = document.createElement('div'); shield.className = 'phone-mouse-shield';
      const node = document.createElement('div'); node.className = 'phone-mouse-cursor'; node.innerHTML = arrow;
      document.body.append(shield, node);
      cursor = { shield, node, finger: null, second: null, x: innerWidth / 2, y: innerHeight / 2 };
      place();
    }
    mode = next; main.classList.toggle('is-on', mode !== 'off');
    for (const button of extras) button.hidden = mode !== 'mouse';
  }
  function hide() {
    if (!cursor) return;
    for (let button = 0; button < 3; button++) release(button);
    loseCapture(); leave(); cursor.shield.remove(); cursor.node.remove(); cursor = null;
    mode = 'off'; main.classList.remove('is-on'); for (const button of extras) { button.hidden = true; button.classList.remove('is-pressed'); }
  }

  // The arrow button: hold for cursor mode, tap to toggle mouse mode.
  let mainPress = null;
  function installButtons() {
    main = document.createElement('button');
    main.type = 'button'; main.className = 'phone-mouse-button'; main.setAttribute('aria-label', 'Mouse'); main.innerHTML = arrow;
    main.style.left = '72px'; main.style.bottom = '16px';
    main.addEventListener('touchstart', (event) => {
      event.preventDefault(); event.stopPropagation();
      const touch = event.changedTouches[0];
      mainPress = { id: touch.identifier, at: performance.now(), timer: setTimeout(() => { if (mainPress && mode === 'off') { mainPress.held = true; show('hold'); } }, HOLD_MS) };
    }, { passive: false });
    const mainLift = (event) => {
      if (!mainPress || ![...event.changedTouches].some((t) => t.identifier === mainPress.id)) return;
      event.preventDefault(); event.stopPropagation();
      clearTimeout(mainPress.timer);
      const { held } = mainPress; mainPress = null;
      if (held) { if (mode === 'hold') hide(); return; }
      if (mode === 'mouse') hide(); else show('mouse');
    };
    main.addEventListener('touchend', mainLift, { passive: false });
    main.addEventListener('touchcancel', mainLift, { passive: false });
    main.addEventListener('contextmenu', (event) => event.preventDefault());
    // M above the arrow, L and R either side between them (the creator's sketch).
    for (const [label, button, left, bottom] of [['L', 0, 10, 78], ['M', 1, 72, 140], ['R', 2, 134, 78]]) {
      const key = document.createElement('button');
      key.type = 'button'; key.className = 'phone-mouse-button'; key.textContent = label; key.hidden = true;
      key.setAttribute('aria-label', ['Left', 'Middle', 'Right'][button] + ' mouse button');
      key.style.left = left + 'px'; key.style.bottom = bottom + 'px';
      let id = null;
      key.addEventListener('touchstart', (event) => { event.preventDefault(); event.stopPropagation(); id = event.changedTouches[0].identifier; key.classList.add('is-pressed'); press(button); }, { passive: false });
      const up = (event) => { if (id === null || ![...event.changedTouches].some((t) => t.identifier === id)) return; event.preventDefault(); event.stopPropagation(); id = null; key.classList.remove('is-pressed'); release(button); };
      key.addEventListener('touchend', up, { passive: false });
      key.addEventListener('touchcancel', up, { passive: false });
      key.addEventListener('contextmenu', (event) => event.preventDefault());
      extras.push(key);
    }
    document.body.append(main, ...extras);
  }

  // Fingers on the shield: in hold mode a second finger is the trackpad; in mouse mode one finger is
  // the trackpad and two fingers scroll. A quick tap of the trackpad finger is a left click.
  const onShield = (touch) => document.elementFromPoint(touch.clientX, touch.clientY)?.classList.contains('phone-mouse-shield') || touch.target?.classList?.contains('phone-mouse-shield');
  addEventListener('touchstart', (event) => {
    if (!cursor) return;
    if (cursor.finger && ![...event.touches].some((t) => t.identifier === cursor.finger.id)) cursor.finger = null;
    for (const touch of event.changedTouches) {
      if (!onShield(touch)) continue;
      if (cursor.finger === null) cursor.finger = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: performance.now(), travel: 0 };
      else if (mode === 'mouse' && cursor.second === null) { cursor.second = { id: touch.identifier, x: touch.clientX, y: touch.clientY }; cursor.finger.travel = Infinity; }
    }
  }, { capture: true, passive: true });
  addEventListener('touchmove', (event) => {
    if (!cursor) return;
    event.preventDefault();
    const finger = [...event.touches].find((t) => t.identifier === cursor.finger?.id), second = [...event.touches].find((t) => t.identifier === cursor.second?.id);
    if (finger && second) {
      // Two fingers: scroll at the cursor (content follows the fingers).
      const dx = (finger.clientX - cursor.finger.x + second.clientX - cursor.second.x) / 2, dy = (finger.clientY - cursor.finger.y + second.clientY - cursor.second.y) / 2;
      wheel(-dx, -dy);
      cursor.finger.x = finger.clientX; cursor.finger.y = finger.clientY; cursor.second.x = second.clientX; cursor.second.y = second.clientY;
      return;
    }
    if (!finger) return;
    cursor.x = Math.max(0, Math.min(innerWidth - 1, cursor.x + finger.clientX - cursor.finger.x));
    cursor.y = Math.max(0, Math.min(innerHeight - 1, cursor.y + finger.clientY - cursor.finger.y));
    cursor.finger.travel += Math.hypot(finger.clientX - cursor.finger.x, finger.clientY - cursor.finger.y);
    cursor.finger.x = finger.clientX; cursor.finger.y = finger.clientY;
    place();
  }, { capture: true, passive: false });
  const lifted = (event) => {
    if (!cursor) return;
    for (const touch of event.changedTouches) {
      if (touch.identifier === cursor.second?.id) cursor.second = null;
      if (touch.identifier === cursor.finger?.id) {
        if (event.type === 'touchend' && cursor.finger.travel < TAP_TRAVEL && performance.now() - cursor.finger.at < TAP_MS) clickAt();
        cursor.finger = null;
      }
    }
  };
  addEventListener('touchend', lifted, { capture: true, passive: true });
  addEventListener('touchcancel', lifted, { capture: true, passive: true });
  addEventListener('blur', () => { if (mode === 'hold') hide(); });

  const install = () => {
    document.head.append(style);
    if (document.readyState === 'complete') mirrorHover(); else addEventListener('load', mirrorHover, { once: true });
    installButtons();
  };
  if (document.body) install(); else addEventListener('DOMContentLoaded', install, { once: true });
})();
