/**
 * Quick Run — the searchable universe, as rows in the shape section 0.2 fixes.
 *
 * Sections 0.2 to 0.4 fix the row, and this module is only that mapping:
 *
 * - one row per active folder, one per active shortcut **placement** (placement ids are the occurrence
 *   identity, so one shortcut in two folders is two rows sharing a name and target and differing in
 *   breadcrumb and result key), one per window-layout member occurrence;
 * - a Link is a shortcut whose target the model's own isWebLink() classifies as http(s) — one pass, no
 *   second index;
 * - the row carries resultKey, type, name, normalizedName, breadcrumb, breadcrumbIds and actionRef, plus
 *   its type-specific authority ids (folder: groupId; shortcut/link: shortcutId and placementId;
 *   layout-item: layoutId, memberId and the descriptorKey the member's identity is noted against), and
 *   `containerId`: the folder that directly holds the occurrence, which is the only field a reveal may
 *   navigate to. actionRef stays a reference, never a copy of a mutable object.
 *
 * Result keys are the pinned scheme: folder:<groupId>, shortcut:<placementId>, link:<placementId>,
 * layout-member:<layoutId>:<memberId>. Breadcrumbs come from persisted folder ancestry and use the
 * contract's separator, with the ancestor ids carried alongside so a caller need not re-walk the tree.
 */
import { ROOT_ID, activeItem, isWebLink, itemsIn } from '../../workspace-model-20260730b.js';
import { descriptorIdentityKey, normaliseQueryText } from './quick-run-types.js';

/** The contract's breadcrumb separator (section 0.4). */
export const QUICK_RUN_BREADCRUMB_SEPARATOR = ' › ';

function labelOf(item) {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  return name === '' ? 'Untitled' : name;
}

/** The ancestor chain above a parent id: names for display, ids for reference. Walked once per row. */
function ancestryFor(state, parentId) {
  const names = [];
  const ids = [];
  let current = parentId;
  const guard = new Set();
  while (current && !guard.has(current)) {
    guard.add(current);
    const group = (state.groups ?? []).find((candidate) => candidate.id === current);
    if (!group) break;
    names.unshift(labelOf(group));
    ids.unshift(group.id);
    current = group.parentId;
  }
  return { breadcrumb: names.join(QUICK_RUN_BREADCRUMB_SEPARATOR), breadcrumbIds: ids };
}

/**
 * The item's own icon, carried exactly as the state holds it, or null when there is nothing to carry.
 *
 * Pass-through, never a decode and never a re-encode: the bytes the canvas paints are the bytes Quick Run
 * paints. A value that is not a non-empty string is nothing at all, and the row falls back to its kind glyph
 * at the surface - an item with no icon must not borrow one, and must not be given an invented one.
 */
function iconOf(item) {
  return typeof item?.icon === 'string' && item.icon !== '' ? item.icon : null;
}

function baseRow(state, id, name, parentId, icon) {
  const ancestry = ancestryFor(state, parentId);
  return {
    resultKey: id,
    type: 'folder',
    name: labelOf({ name }),
    normalizedName: normaliseQueryText(labelOf({ name })),
    // The item's own artwork rides the row beside its kind. The kind stays: it is what the surface draws when
    // the item has no icon, and it is what names the row for anything that cannot paint a picture.
    icon: typeof icon === 'string' && icon !== '' ? icon : null,
    breadcrumb: ancestry.breadcrumb,
    breadcrumbIds: ancestry.breadcrumbIds,
    // The folder that directly holds this occurrence, which is where a reveal has to navigate to. It is
    // stamped here rather than derived by the caller because the breadcrumb chain cannot answer it: a
    // root-level occurrence has an empty chain, and a layout member's chain ends with the layout itself
    // (not a folder), so reading a destination out of the chain sends the reader to the wrong place or
    // nowhere at all. The walk already knows the parent, so it records it.
    containerId: typeof parentId === 'string' && parentId !== '' ? parentId : ROOT_ID,
    actionRef: null,
  };
}

function folderRows(state, parentId, seen, rows) {
  for (const item of itemsIn(state, parentId)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind === 'group') {
      rows.push({
        ...baseRow(state, 'folder:' + item.id, item.name, item.parentId, iconOf(item)),
        groupId: item.id,
      });
      folderRows(state, item.id, seen, rows);
    } else if (item.kind === 'shortcut') {
      const link = isWebLink(item);
      const type = link ? 'link' : 'shortcut';
      const row = baseRow(state, type + ':' + item.id, item.name, item.parentId, iconOf(item));
      rows.push({
        ...row,
        type,
        placementId: item.id,
        shortcutId: item.shortcutId,
        target: item.target,
        // A reference to the shared record, not a copy of it: section 0.2 forbids the latter.
        actionRef: { kind: 'shortcut', shortcutId: item.shortcutId, placementId: item.id },
      });
    }
  }
}

function layoutMemberRows(state, rows) {
  // The same rule the folders and placements already get from itemsIn: a binned layout, or one under a
  // binned group, is not in the searchable universe (section 2.1's "active", section 6's bin rules). The
  // members are reached through their layout here rather than through itemsIn, which is exactly why this
  // loop has to ask the model instead of assuming.
  for (const layout of state.windowLayouts ?? []) {
    if (!activeItem(state, layout)) continue;
    const layoutName = labelOf(layout);
    const ancestry = ancestryFor(state, layout.parentId);
    const breadcrumb = ancestry.breadcrumb === ''
      ? layoutName
      : ancestry.breadcrumb + QUICK_RUN_BREADCRUMB_SEPARATOR + layoutName;
    for (const member of layout.arrangement?.members ?? []) {
      const title = typeof member.descriptor?.title === 'string' && member.descriptor.title.trim() !== ''
        ? member.descriptor.title.trim()
        : 'Untitled window';
      rows.push({
        resultKey: 'layout-member:' + layout.id + ':' + member.id,
        type: 'layout-item',
        name: title,
        normalizedName: normaliseQueryText(title),
        breadcrumb,
        breadcrumbIds: [...ancestry.breadcrumbIds, layout.id],
        // A layout has no icon of its own (024: layout name/icon customization was removed), so this row
        // answers null like every other iconless row rather than leaving the field out of the shape.
        icon: null,
        // The folder holding the layout, not the layout: a reveal navigates to a folder, and the layout id
        // is not one (the workspace's own open-selection command knows groups and shortcuts, not layouts).
        containerId: typeof layout.parentId === 'string' && layout.parentId !== '' ? layout.parentId : ROOT_ID,
        // The identity the persisted descriptor declares, in the one vocabulary the resolution module also
        // reads. Availability is noted against this, so a member whose fingerprint changed is not mistaken
        // for the window an earlier answer was about.
        descriptorKey: descriptorIdentityKey(member.descriptor),
        actionRef: { kind: 'layout-member', layoutId: layout.id, memberId: member.id },
        layoutId: layout.id,
        memberId: member.id,
      });
    }
  }
}

/** Every row Quick Run may show, before a query narrows them. */
export function quickRunRows(state) {
  const rows = [];
  folderRows(state, undefined, new Set(), rows);
  layoutMemberRows(state, rows);
  return rows;
}