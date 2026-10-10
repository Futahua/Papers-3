import { createHash } from 'node:crypto';
import type { NativePaneBridge, NativePaneSnapshot, PaneReply, PaneRect } from './nativePaneBridge';
export interface PanePage {
    windowId: number;
    surfaceId: string;
    key: string;
    projectId: string;
    title: string;
    tabStyle?: string;
}
interface Presentation {
    bounds: PaneRect | null;
    visible: boolean;
}
/** Native checkpoints own group membership. Existing logical pages own content,
 * identity and document saves; this owner only composes their retained views. */
export function createPaneBackpackPages(input: {
    bridge: () => NativePaneBridge | null | undefined;
    pages: () => PanePage[];
    outer: (page: PanePage) => Presentation;
    present: (page: PanePage, rect: PaneRect | null, visible: boolean) => void;
    adopt: (page: PanePage, parent: PanePage) => Promise<void>;
    exists: (key: string) => Promise<boolean>;
}) {
    const layouts = new Map<string, NativePaneSnapshot>(), checking = new Set<string>();
    const titleUpdates = new Map<string, Promise<void>>();
    let tail = Promise.resolve();
    const locate = (id: string) => input.pages().find(p => p.surfaceId === id || p.key === id);
    function placement(page: PanePage) {
        for (const [owner, snapshot] of layouts) {
            const parent = locate(owner.slice(owner.indexOf(':') + 1));
            if (!parent || parent.windowId !== page.windowId)
                continue;
            for (const group of snapshot.groups)
                if (group.tabs.some(t => t.preview?.PageKey === page.key))
                    return { parent, snapshot, group };
        }
        return null;
    }
    function refresh() {
        for (const page of input.pages()) {
            const place = placement(page);
            if (!place)
                continue;
            const parent = input.outer(place.parent), outer = input.outer(page), r = place.group.content;
            const visible = Boolean(parent.visible && place.snapshot.presented && place.group.presentation !== 'minimized' && place.group.tabs.some(t => t.preview?.PageKey === page.key && t.active) && (!place.snapshot.groups.some(g => g.presentation === 'maximized') || place.group.presentation === 'maximized'));
            input.present(page, parent.visible ? parent.bounds ? { x: parent.bounds.x + r.x, y: parent.bounds.y + r.y, width: r.width, height: r.height } : null : outer.bounds, parent.visible ? visible : outer.visible);
        }
    }
    function syncTitles(): Promise<void> {
        for (const [owner, layout] of layouts) {
            // Presentation snapshots may decorate a page title for the UI.
            // Compare the native reference itself so its durable name is updated.
            const snapshot = input.bridge()?.snapshot(owner) ?? layout;
            if (!snapshot.presented) continue;
            for (const group of snapshot.groups) for (const tab of group.tabs) {
                const page = tab.preview?.PageKey ? locate(tab.preview.PageKey) : null;
                const identity = owner + ':' + tab.id;
                if (!page || tab.preview?.Name === page.title || titleUpdates.has(identity)) continue;
                const task = tail.then(async () => {
                    const bridge = input.bridge(), current = bridge?.snapshot(owner);
                    const currentGroup = current?.groups.find(g => g.tabs.some(t => t.id === tab.id));
                    const currentTab = currentGroup?.tabs.find(t => t.id === tab.id);
                    const livePage = currentTab?.preview?.PageKey ? locate(currentTab.preview.PageKey) : null;
                    if (!bridge?.has(owner) || !current?.presented || !currentGroup || !livePage || currentTab?.preview?.Name === livePage.title) return;
                    await bridge.command(owner, 'document-add', {
                        tabId: tab.id, groupId: currentGroup.id,
                        preview: { ...currentTab!.preview, Name: livePage.title },
                    });
                }).catch(() => {}).finally(() => { titleUpdates.delete(identity); });
                titleUpdates.set(identity, task);
                tail = task;
            }
        }
        return Promise.all([...titleUpdates.values()]).then(() => undefined);
    }
    function accept(owner: string, snapshot: NativePaneSnapshot) {
        const old = layouts.get(owner);
        if (old && snapshot.binding === old.binding && (snapshot.stateRevision < old.stateRevision || snapshot.geometryRevision < old.geometryRevision))
            return;
        const prior = new Set(old?.groups.flatMap(g => g.tabs.map(t => t.preview?.PageKey).filter(Boolean)) ?? []);
        layouts.set(owner, snapshot);
        const next = new Set(snapshot.groups.flatMap(g => g.tabs.map(t => t.preview?.PageKey).filter(Boolean)));
        for (const key of prior)
            if (!next.has(key)) {
                const page = locate(key!);
                if (page) {
                    const outer = input.outer(page);
                    input.present(page, outer.bounds, outer.visible);
                }
            }
        refresh();
        void syncTitles();
        // A parked parent's checkpoint may outlive a page explicitly destroyed
        // elsewhere. The authoritative page set decides whether that ref survives.
        for (const group of snapshot.groups)
            for (const tab of group.tabs)
                if (tab.preview?.PageKey && !locate(tab.preview.PageKey)) {
                    const key = tab.preview.PageKey, identity = owner + ':' + tab.id;
                    if (checking.has(identity))
                        continue;
                    checking.add(identity);
                    void input.exists(key).then(async (exists) => {
                        const bridge = input.bridge();
                        if (exists || locate(key) || !bridge?.has(owner))
                            return;
                        if (!bridge.snapshot(owner)?.groups.some(g => g.tabs.some(t => t.id === tab.id && t.preview?.PageKey === key)))
                            return;
                        await bridge.command(owner, 'document-remove', { tabId: tab.id });
                    }).catch(() => { }).finally(() => checking.delete(identity));
                }
    }
    async function check(owner: string, id: string, groupId: string, side: string): Promise<PaneReply> {
        const page = locate(id), parent = locate(owner.slice(owner.indexOf(':') + 1)), bridge = input.bridge(), snapshot = bridge?.snapshot(owner);
        if (!page || !parent || !bridge || !snapshot)
            return { ok: false, error: 'That page or layout is unavailable.' };
        if (page.surfaceId === parent.surfaceId || page.projectId === parent.projectId)
            return { ok: false, error: 'An AYG page cannot enter its own layout.' };
        if (placement(page))
            return { ok: false, error: 'That page is already in a layout group.' };
        if (placement(parent) || layouts.has(`${page.windowId}:${page.surfaceId}`) && layouts.get(`${page.windowId}:${page.surfaceId}`)!.groups.some(g => g.tabs.some(t => t.preview?.PageKey)))
            return { ok: false, error: 'Nested page layouts cannot contain each other.' };
        const target = snapshot.groups.find(g => g.id === groupId);
        if (!target)
            return { ok: false, error: 'That group no longer exists.' };
        if (side !== 'center') {
            const fit = await bridge.command(owner, 'can-insert-group', { groupId, side, width: 240, height: 192 });
            if (!fit.ok)
                return { ok: false, error: 'There is not enough room for this page.' };
        }
        const width = ['left', 'right'].includes(side) ? target.slot.width / 2 : target.content.width;
        const height = ['top', 'bottom'].includes(side) ? target.slot.height / 2 - 32 : target.content.height;
        if (!await bridge.canFitPageGroup(page.windowId, [page.surfaceId], width, height, true))
            return { ok: false, error: 'This page’s applications cannot fit in that group.' };
        return { ok: true };
    }
    function attach(owner: string, id: string, groupId: string, side: string) {
        const task = tail.then(async () => {
            const fit = await check(owner, id, groupId, side);
            if (!fit.ok)
                return fit;
            const page = locate(id)!, parent = locate(owner.slice(owner.indexOf(':') + 1))!, bridge = input.bridge()!;
            const tabId = 'preview:page-' + createHash('sha256').update(page.key).digest('hex').slice(0, 24), before = bridge.snapshot(owner)!;
            let added = false;
            try {
                let result = await bridge.command(owner, 'document-add', { tabId, groupId, preview: { Id: tabId, PageKey: page.key, Name: page.title, TabStyle: page.tabStyle } });
                if (!result.ok)
                    return result;
                added = true;
                if (side !== 'center') {
                    result = await bridge.command(owner, 'split', { tabId, groupId, newGroupId: 'page-' + createHash('sha256').update(page.key).digest('hex').slice(0, 24), side });
                    if (!result.ok)
                        throw Error(result.error || 'The page cannot fit here.');
                    groupId = bridge.snapshot(owner)!.groups.find(g => g.tabs.some(t => t.id === tabId))!.id;
                }
                // Existing topology transfer also collapses the former outer
                // split when the retained page joins a layout in the same window.
                result = await bridge.command(owner, 'select', { groupId, tabId });
                if (!result.ok)
                    throw Error(result.error || 'Page selection failed.');
                await input.adopt(page, parent);
                accept(owner, bridge.snapshot(owner)!);
                return result;
            }
            catch (error) {
                if (added) {
                    await bridge.command(owner, 'document-remove', { tabId });
                    const empty = bridge.snapshot(owner)!.groups.find(g => g.id.startsWith('page-') && !g.tabs.length);
                    if (empty && bridge.snapshot(owner)!.groups.length > 1)
                        await bridge.command(owner, 'close-group', { groupId: empty.id, destination: before.groups[0]!.id });
                }
                for (const group of before.groups)
                    if (group.selected && bridge.snapshot(owner)?.groups.find(g => g.id === group.id)?.tabs.some(t => t.id === group.selected))
                        await bridge.command(owner, 'select', { groupId: group.id, tabId: group.selected });
                return { ok: false, error: String(error) };
            }
        });
        tail = task.then(() => undefined, () => undefined);
        return task;
    }
    async function removePage(id: string) {
        const page = locate(id), bridge = input.bridge();
        if (!page || !bridge)
            return;
        for (const [owner, snapshot] of layouts)
            if (bridge.has(owner))
                for (const tab of snapshot.groups.flatMap(g => g.tabs))
                    if (tab.preview?.PageKey === page.key) {
                        const reply = await bridge.command(owner, 'document-remove', { tabId: tab.id });
                        if (!reply.ok)
                            throw Error(reply.error || 'Could not remove the closed page from its layout.');
                        if (reply.snapshot)
                            accept(owner, reply.snapshot);
                    }
    }
    return { accept, refresh, syncTitles, check, attach, removePage, controls: (id: string) => { const p = locate(id); return Boolean(p && placement(p) && input.outer(placement(p)!.parent).visible); } };
}
