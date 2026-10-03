import type { WorkspaceTabGroup } from '@shared/workspaceTopology';

export function rebuildWorkspaceGroupMap(
  previous: ReadonlyMap<string, string>,
  dockviewGroups: Array<{ id: string; panelIds: string[] }>,
  papersGroups: WorkspaceTabGroup[],
): Map<string, string> {
  const liveDockviewIds = new Set(dockviewGroups.map((group) => group.id));
  const livePapersIds = new Set(papersGroups.map((group) => group.groupId));
  const next = new Map(
    [...previous].filter(([dockviewId, papersId]) =>
      liveDockviewIds.has(dockviewId)
      && livePapersIds.has(papersId)
      && (() => {
        const papers = papersGroups.find((group) => group.groupId === papersId);
        const dockview = dockviewGroups.find((group) => group.id === dockviewId);
        return Boolean(papers && dockview
          && (papers.surfaceIds.length === 0
            || dockview.panelIds.some((surfaceId) => papers.surfaceIds.includes(surfaceId))));
      })()),
  );
  for (const group of papersGroups) {
    if ([...next.values()].includes(group.groupId)) continue;
    const matching = dockviewGroups.find((dockviewGroup) =>
      !next.has(dockviewGroup.id)
      && group.surfaceIds.some((surfaceId) => dockviewGroup.panelIds.includes(surfaceId)));
    if (matching) next.set(matching.id, group.groupId);
  }
  return next;
}
