/**
 * WHICH SENDERS MAY DRIVE HOST PROJECT CHANNELS, AND WHICH CHANNELS EACH MAY USE.
 *
 * The defect these tests pin down, reported from the installed build:
 *
 *   Error invoking remote method host:backpack-project:state-load:
 *   Error: host channel called from non-host sender
 *
 * The launcher surface was bound as an owned project surface, but the guard
 * asked two OTHER registries - the detach and compact-widget registries - which
 * the launcher is not in. So the read was refused, and with it every channel the
 * launcher needs: there is nothing to search, nothing to run, nothing to copy.
 * The creator would have typed, seen nothing, and had a chord that does not work.
 *
 * WHY THE TESTS ARE SHAPED THIS WAY
 * The fix must make the guard MORE PRECISE, not weaker. So these tests hold three
 * separate lines at once:
 *   1. the launcher is admitted, as an owned project surface of its own KIND;
 *   2. a page that is not a bound owned surface is still refused, even if the
 *      host created its window and it carries a project URL;
 *   3. admission is per CAPABILITY, so admitting the launcher does not hand it
 *      window enumeration, native dialogs, or the ability to write shared state.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BackpackSurfaceRegistry,
  COMPACT_WIDGET_SURFACE_KIND,
  DETACHED_SURFACE_KIND,
  LAUNCHER_SURFACE_KIND,
  WORKSPACE_SURFACE_KIND,
  capabilityForChannel,
  isAllowedProjectSurfaceSender,
  projectCapabilityDecision,
} from '../../src/main/backpacks/backpackSurfaceRegistry';
import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';

const PROJECT = 'bp-11111111-1111-4111-8111-111111111111';
const OTHER = 'bp-22222222-2222-4222-8222-222222222222';
const PROJECT_URL = `papers-backpack://${PROJECT}/_papers-open/abc/public/index.html`;
const LAUNCHER_URL = `${PROJECT_URL}?papers-surface=command-surface`;

/** The live registries, as `index.ts` composes them. */
function harness() {
  const detachRegistry = new BackpackSurfaceRegistry();
  const widgetRegistry = new BackpackSurfaceRegistry();
  const surfaces = createSurfaceContextRegistry();
  return { detachRegistry, widgetRegistry, surfaces };
}

describe('the launcher surface is an owned project surface', () => {
  it('admits a launcher-kind sender for its own project', () => {
    const h = harness();
    h.surfaces.bind(900, { projectId: PROJECT, windowId: 1, kind: LAUNCHER_SURFACE_KIND });

    expect(isAllowedProjectSurfaceSender({
      senderId: 900,
      url: LAUNCHER_URL,
      isWorkspaceSender: false,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(true);
  });

  it('refuses a launcher-kind sender claiming a project it is not bound to', () => {
    // Binding and URL must agree. This is the check that survived the change.
    const h = harness();
    h.surfaces.bind(900, { projectId: PROJECT, windowId: 1, kind: LAUNCHER_SURFACE_KIND });

    expect(isAllowedProjectSurfaceSender({
      senderId: 900,
      url: `papers-backpack://${OTHER}/_papers-open/abc/public/index.html`,
      isWorkspaceSender: false,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(false);
  });

  it('refuses a project page the host did not bind, even with a correct URL', () => {
    // THE PROPERTY THAT MUST SURVIVE. A page which is not an owned project
    // surface cannot drive host channels - being a real project page is not
    // enough, and neither is the host having created the window.
    const h = harness();

    expect(isAllowedProjectSurfaceSender({
      senderId: 901,
      url: LAUNCHER_URL,
      isWorkspaceSender: false,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(false);
  });

  it('refuses a bound sender whose URL is not a project URL at all', () => {
    const h = harness();
    h.surfaces.bind(902, { projectId: PROJECT, windowId: 1, kind: LAUNCHER_SURFACE_KIND });

    expect(isAllowedProjectSurfaceSender({
      senderId: 902,
      url: 'https://example.com/',
      isWorkspaceSender: false,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(false);
  });

  it('still admits the surfaces it admitted before, from their own bindings', () => {
    const h = harness();
    h.surfaces.bind(800, { projectId: PROJECT, windowId: 1, kind: 'project' });
    h.surfaces.bind(801, { projectId: PROJECT, windowId: 1, kind: DETACHED_SURFACE_KIND });
    h.surfaces.bind(802, { projectId: PROJECT, windowId: 1, kind: 'widget' });
    // The legacy registries are still populated for the paths that use them.
    h.detachRegistry.register(801, PROJECT, DETACHED_SURFACE_KIND);
    h.widgetRegistry.register(802, PROJECT, COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    const allowed = (senderId: number): boolean => isAllowedProjectSurfaceSender({
      senderId,
      url: LAUNCHER_URL,
      isWorkspaceSender: false,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    });

    expect(allowed(800)).toBe(true);
    expect(allowed(801)).toBe(true);
    expect(allowed(802)).toBe(true);
    expect(allowed(803)).toBe(false);
  });
});

describe('what each kind of owned surface may do', () => {
  const full = (kind: string, capability: string) =>
    projectCapabilityDecision(kind as never, capability as never);

  it('lets the launcher read and run, which is what a launcher is for', () => {
    for (const channel of [
      `host:backpack-project:state-load`,
      `host:backpack-project:state-load-versioned`,
      `host:backpack-project:launch-shortcut`,
      `host:backpack-project:run-action`,
      `host:backpack-project:copy-text`,
    ]) {
      expect(capabilityForChannel(channel)).not.toBeNull();
      expect(full(LAUNCHER_SURFACE_KIND, capabilityForChannel(channel)!)).toBe(true);
    }
  });

  it('does NOT let the launcher write shared project state', () => {
    // Decided deliberately, not by adjacency. The launcher is transient: it
    // closes on blur, has no draft, no undo, and no conflict UI. A write from it
    // is unrecoverable the moment focus moves, and state-save-checked writes the
    // SAME document a real workspace surface may be editing. Running an item is
    // an action the project defines; rewriting its document is not the same act.
    expect(capabilityForChannel('host:backpack-project:state-save-checked')).toBe('mutate');
    expect(capabilityForChannel('host:backpack-project:state-save')).toBe('mutate');
    expect(full(LAUNCHER_SURFACE_KIND, 'mutate')).toBe(false);
  });

  it('does not let the launcher pick windows, reveal local targets, or join the delegate wave', () => {
    // A launcher is a text box. Local file-manager reveal and native/delegate
    // capabilities would let a transient overlay reach arbitrary desktop data.
    for (const kind of ['reveal', 'native', 'delegate']) {
      expect(full(LAUNCHER_SURFACE_KIND, kind)).toBe(false);
    }
    // Copying TEXT and opening a web URL are launcher actions; revealing a local
    // target is not. They are deliberately separate capabilities.
    expect(full(LAUNCHER_SURFACE_KIND, 'clipboard')).toBe(true);
    expect(capabilityForChannel('host:backpack-project:reveal-shortcut')).toBe('reveal');
    expect(capabilityForChannel('host:backpack-project:pick-target')).toBe('reveal');
    expect(capabilityForChannel('host:backpack-project:open-web-link')).toBe('invoke');
    expect(full(LAUNCHER_SURFACE_KIND, 'invoke')).toBe(true);
    expect(capabilityForChannel('host:backpack-project:copy-text')).toBe('clipboard');
  });

  it('leaves a full project surface able to do everything it could before', () => {
    for (const kind of ['project', DETACHED_SURFACE_KIND, 'widget']) {
      for (const capability of ['read', 'invoke', 'clipboard', 'reveal', 'mutate', 'native', 'delegate']) {
        expect(full(kind, capability)).toBe(true);
      }
    }
  });

  it('gives an unknown surface kind nothing by default', () => {
    // The failure mode this replaces: a new kind silently inheriting whichever
    // allow-list happened to match. A new kind must be granted deliberately.
    expect(full('something-new', 'read')).toBe(false);
    expect(full('something-new', 'mutate')).toBe(false);
  });

  it('says a channel it does not know is not a project channel', () => {
    expect(capabilityForChannel('host:app:build-identity')).toBeNull();
    expect(capabilityForChannel('host:window-capability:list')).toBeNull();
  });

  it('admits a workspace frame, which is authorized by being the live renderer', () => {
    const h = harness();
    expect(isAllowedProjectSurfaceSender({
      senderId: 700,
      url: PROJECT_URL,
      isWorkspaceSender: true,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(true);
    // The sender is a whole webContents - the runtime's own view - so its URL is
    // authoritative for it and the project-host check is the protocol check.
    // A non-project URL is still refused.
    expect(isAllowedProjectSurfaceSender({
      senderId: 700,
      url: 'https://example.com/',
      isWorkspaceSender: true,
      surfaces: h.surfaces,
      detachRegistry: h.detachRegistry,
      widgetRegistry: h.widgetRegistry,
    })).toBe(false);
  });
});

describe('the launcher kind is its own kind', () => {
  it('is a distinct kind name, not a reused widget', () => {
    // Reusing 'widget' would have been the one-line fix. It would also mean the
    // launcher is a compact widget as far as every other reader is concerned -
    // including the layout-key lookups and the widget-only capability checks.
    expect(LAUNCHER_SURFACE_KIND).not.toBe(COMPACT_WIDGET_SURFACE_KIND);
    expect(LAUNCHER_SURFACE_KIND).not.toBe(WORKSPACE_SURFACE_KIND);
    expect(LAUNCHER_SURFACE_KIND).not.toBe(DETACHED_SURFACE_KIND);
  });
});

describe('every channel a project page can reach is classified', () => {
  /**
   * The list is EXTRACTED FROM THE PRELOAD, not hand-maintained.
   *
   * This exists because two real channels were missing from the map, and the
   * consequence was silent in the worst way: the capability check answers "not
   * granted" for an unclassified channel, so a missing entry REFUSES a channel a
   * project is entitled to. `local-service-fetch` arrived from a merge and
   * `open-new-surface` from the capability work itself; neither was caught by
   * tests that only checked the channels someone remembered to list.
   */
  const preload = readFileSync(
    new URL('../../src/preload/backpackProject.ts', import.meta.url),
    'utf8',
  );
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('(host:backpack-project:[a-z-]+)'/g)]
    .map((match) => match[1]!)
    .filter((channel, index, all) => all.indexOf(channel) === index)
    .sort();

  it('found the project channels in the preload at all', () => {
    // A guard on the guard: if the preload changes shape this test must fail
    // rather than silently check an empty list.
    expect(invoked.length).toBeGreaterThan(15);
    expect(invoked).toContain('host:backpack-project:state-load');
    expect(invoked).toContain('host:backpack-project:local-service-fetch');
  });

  it('classifies every one of them, so none is refused for being unclassified', () => {
    expect(invoked.filter((channel) => capabilityForChannel(channel) === null)).toEqual([]);
  });

  it('gives the local-service bridge its own capability, and the launcher does not get it', () => {
    // The bridge reaches a service on this machine with a credential the project
    // declared. That is its own kind of reach: not the project's document, and
    // not the creator's desktop.
    expect(capabilityForChannel('host:backpack-project:local-service-fetch')).toBe('service');
    expect(projectCapabilityDecision(LAUNCHER_SURFACE_KIND, 'service')).toBe(false);
    // The surfaces the bridge was built for keep it.
    for (const kind of ['project', DETACHED_SURFACE_KIND, 'widget']) {
      expect(projectCapabilityDecision(kind, 'service')).toBe(true);
    }
  });

  it('distinguishes opening a surface from writing the project document', () => {
    // Both change the workspace; only one is a launcher writing state it cannot
    // take back.
    expect(capabilityForChannel('host:backpack-project:open-new-surface')).toBe('surface');
    expect(projectCapabilityDecision(LAUNCHER_SURFACE_KIND, 'surface')).toBe(true);
    expect(capabilityForChannel('host:backpack-project:state-save-checked')).toBe('mutate');
    expect(projectCapabilityDecision(LAUNCHER_SURFACE_KIND, 'mutate')).toBe(false);
  });
});
