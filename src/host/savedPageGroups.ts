export interface SavedPage {
  key: string;
  title: string;
  windowId: number | null;
  current: boolean;
  workspaceId?: string;
}

/** The durable workspace partition is exactly what showPage restores. */
export function savedPageGroups(pages: SavedPage[]): Array<{id:string;hue:number;pages:SavedPage[]}> {
  const groups = new Map<string, {id:string;hue:number;pages:SavedPage[]}>();
  for (const page of pages) {
    if (page.windowId !== null) continue;
    const id = page.workspaceId ?? page.key;
    let group = groups.get(id);
    if (!group) {
      let hash = 0;
      for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
      group = {id,hue:(hash>>>0)%360,pages:[]};
      groups.set(id,group);
    }
    group.pages.push(page);
  }
  return [...groups.values()];
}
