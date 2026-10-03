const svg = (paths) => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
function button(doc, title, paths) {
  const b = doc.createElement('button');
  b.type = 'button'; b.className = 'navigator-icon-button'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(paths); return b;
}
const parentPath = (value) => {
  const p = String(value || '').replace(/\//g, '\\').replace(/\\+$/, '');
  const unc = p.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\.*)?$/);
  if (unc) {
    const shareRoot = `\\\\${unc[1]}\\${unc[2]}`;
    if (p.toLocaleLowerCase() === shareRoot.toLocaleLowerCase()) return shareRoot;
    const i = p.lastIndexOf('\\');
    return i < shareRoot.length ? shareRoot : p.slice(0, i);
  }
  const drive = p.match(/^[A-Za-z]:/);
  if (drive) {
    const driveRoot = `${drive[0]}\\`;
    if (p.length <= driveRoot.length) return driveRoot;
    const i = p.lastIndexOf('\\');
    return i < driveRoot.length ? driveRoot : p.slice(0, i);
  }
  const i = p.lastIndexOf('\\');
  return i <= 0 ? p : p.slice(0, i);
};

export function beginNavigatorNativeDrag({ event, paths, host }) {
  const unique = [...new Set((paths || []).filter((path) => typeof path === 'string' && path))];
  if (!event?.dataTransfer || unique.length === 0) return false;

  // Electron's native file-drag handoff replaces Chromium's HTML5 drag.
  // If both are left alive, two drag loops overlap and can strand the Chromium
  // drag image or tear down the renderer. Cancel the browser drag first.
  event.preventDefault();
  try {
    void Promise.resolve(host?.fileCapability?.('native-drag', { paths: unique })).catch(() => {});
  } catch {
    // The cancelled HTML5 drag stays cancelled if the host seam is unavailable.
  }
  return true;
}

export function aygNavigatorNativePaths({ itemId, selectedIds, resolvePaths }) {
  if (typeof itemId !== 'string' || typeof resolvePaths !== 'function') return [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return resolvePaths(selected.has(itemId) ? [...selected] : [itemId]);
}

export function createWorkspaceNavigator(o) {
  const d = o.document, panel = d.querySelector('#workspace-navigator');
  if (!panel || !o.workspace || !o.host?.fileCapability) return Object.freeze({
    render() {},
    syncCanvasSelection() {},
    isMachineMode: () => false,
    isCollapsed: () => true,
    setCollapsed() {},
  });
  o.workspace.classList.add('navigator-docked');
  const s = {
    mode: 'ayg',
    view: 'tree',
    collapsed: false,
    expanded: new Set([o.rootId]),
    machineExpanded: new Set(),
    machineRoot: null,
    machineListings: new Map(),
    selected: null,
    path: null,
    history: [],
    hi: -1,
    aygHistory: [],
    aygHi: -1,
    aygSkipHistory: false,
    gen: 0,
    renderGen: 0,
    icons: new Map(),
    locationKey: '',
    width: 252,
    searchQuery: '',
    searchGeneration: 0,
    searchTimer: null,
    searchResult: null,
    searchFilters: { name:'', path:'', type:'', size:'', modified:'' },
    searchSort: { key:null, direction:1 },
    machineSort: { key:'name', direction:1 },
  };
  try {
    const savedWidthRaw = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-width');
    const savedWidth = savedWidthRaw == null ? NaN : Number(savedWidthRaw);
    if (Number.isFinite(savedWidth)) s.width = Math.max(176, Math.min(560, savedWidth));
    const savedView = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-view');
    if (savedView === 'nav' || savedView === 'tree') s.view = savedView;
    s.collapsed = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-collapsed') === '1';
    const savedMachineRoot = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-machine-root');
    if (o.isAbsoluteWindowsPath(savedMachineRoot)) s.machineRoot = savedMachineRoot;
  } catch {
    // Storage is convenience only.
  }
  const head = d.createElement('header'); head.className = 'workspace-navigator-header';
  const provider = d.createElement('button'); provider.type = 'button'; provider.className = 'workspace-navigator-provider';
  const viewToggle = button(d,'Switch navigation mode',['M4 5h3','M4 10h3','M4 15h3','M9 5h7','M9 10h7','M9 15h7']);
  viewToggle.classList.add('workspace-navigator-view-toggle');
  const viewLabel = d.createElement('span'); viewLabel.className = 'workspace-navigator-view-label'; viewToggle.append(viewLabel);
  const collapse = button(d,'Collapse navigator',['M12.5 4.5 7 10l5.5 5.5']); collapse.classList.add('workspace-navigator-collapse');
  const tools = d.createElement('div'); tools.className = 'workspace-navigator-toolbar';
  const back = button(d,'Back',['M12.5 4.5 7 10l5.5 5.5']), fwd = button(d,'Forward',['M7.5 4.5 13 10l-5.5 5.5']);
  const up = button(d,'Up',['M5 11l5-5 5 5','M10 6v9']), home = button(d,'Home',['M3.5 9.5 10 4l6.5 5.5','M5.5 8.5v7h9v-7']), refresh = button(d,'Refresh',['M15.5 7A6 6 0 1 0 16 12','M15.5 7V3.5','M15.5 7H12']), copy = button(d,'Copy',['M7 7h9v9H7z','M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4']);
  const move = button(d,'Move',['M4 2.5h7l3 3v12H4z','M11 2.5v4h4','M8 11h8','M13 8l3 3-3 3']), paste = button(d,'Paste',['M6 5h8v12H6z','M8 5V3h4v2']);
  const rename = button(d,'Rename',['M4 15h4l8-8-4-4-8 8z','M11 4l4 4']), del = button(d,'Delete',['M4 6h12','M7 6v10h6V6','M8 4h4']);
  const reveal = button(d,'Reveal',['M3 6h5l1.5 2H17v8H3z','M3 9h14']); tools.append(back,fwd,up,home,refresh,copy,move,paste,rename,del,reveal);
  head.append(provider, tools, viewToggle, collapse);
  const loc = d.createElement('div'); loc.className = 'workspace-navigator-location';
  const locTrack = d.createElement('div'); locTrack.className = 'workspace-navigator-location-track'; loc.append(locTrack);
  const search = d.createElement('div'); search.className = 'workspace-navigator-search';
  const searchInput = d.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Everything';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  searchInput.setAttribute('aria-label', 'Search files with Everything');
  const searchInfo = d.createElement('div'); searchInfo.className = 'workspace-navigator-search-info';
  search.append(searchInput, searchInfo);
  const body = d.createElement('div'); body.className = 'workspace-navigator-body';
  const resizer = d.createElement('div'); resizer.className = 'workspace-navigator-resizer'; resizer.setAttribute('role','separator'); resizer.setAttribute('aria-orientation','vertical'); resizer.setAttribute('aria-label','Resize navigator');
  panel.replaceChildren(head,search,loc,body,resizer);
  o.workspace.style.setProperty('--workspace-navigator-width', `${s.width}px`);
  const icon = (x) => x.icon ? `<img src="${x.icon}" alt="">` : (x.kind === 'group' || x.kind === 'folder')
    ? svg(['M2.5 6h5l1.5 2h8.5v8.5h-15z']) : o.isWebLink(x)
      ? svg(['M3 10a7 7 0 1 0 14 0 7 7 0 1 0-14 0','M3.5 10h13','M10 3c2 2 2 12 0 14','M10 3c-2 2-2 12 0 14'])
      : svg(['M5 2.5h7l3 3v12H5z','M12 2.5v4h4']);
  function hydrateArt(art, item) {
    if (item.kind !== 'shortcut' || item.icon) return;
    const web = o.isWebLink(item);
    const key = web ? `web:${item.target}` : `shortcut:${item.shortcutId}`;
    let pending = s.icons.get(key);
    if (!pending) {
      pending = Promise.resolve(
        web ? o.host.resolveWebIcon(item.target) : o.host.shortcutIcon({ actionId: item.shortcutId }),
      ).then((result) => web ? result?.icon ?? null : result ?? null).catch(() => null);
      s.icons.set(key, pending);
    }
    pending.then((source) => {
      if (!source || !art.isConnected) return;
      const image = d.createElement('img');
      image.src = source;
      image.alt = '';
      art.replaceChildren(image);
    });
  }
  const machineIconTargets = new WeakMap();
  let machineIconObserver = null;
  function loadMachineArt(art, item) {
    const key = 'native:' + item.path.toLocaleLowerCase();
    let pending = s.icons.get(key);
    if (!pending) {
      pending = o.host.fileCapability('icon', { path: item.path })
        .then((result) => result?.ok ? result.icon ?? null : null)
        .catch(() => null);
      s.icons.set(key, pending);
    }
    pending.then((source) => {
      if (!source || !art.isConnected) return;
      const image = d.createElement('img');
      image.src = source;
      image.alt = '';
      art.replaceChildren(image);
    });
  }
  function hydrateMachineArt(art, item) {
    if (!machineIconObserver) {
      loadMachineArt(art, item);
      return;
    }
    machineIconTargets.set(art, item);
    machineIconObserver.observe(art);
  }
  if (typeof d.defaultView?.IntersectionObserver === 'function') {
    machineIconObserver = new d.defaultView.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        machineIconObserver.unobserve(entry.target);
        const item = machineIconTargets.get(entry.target);
        if (item) loadMachineArt(entry.target, item);
      }
    }, { root: body, rootMargin: '96px 0px' });
  }
  function syncChrome() {
    panel.dataset.mode = s.mode;
    panel.dataset.view = s.view;
    provider.textContent = s.mode === 'machine' ? 'Opus' : 'As you Go';
    provider.title = s.mode === 'machine' ? 'Switch to As you Go' : 'Switch to Opus';
    provider.setAttribute('aria-label', provider.title);
    viewLabel.textContent = s.view === 'tree' ? 'Tree' : 'Nav';
    viewToggle.title = s.view === 'tree' ? 'Switch to navigation mode' : 'Switch to tree mode';
    viewToggle.setAttribute('aria-label', viewToggle.title);
    panel.classList.toggle('collapsed', s.collapsed);
    o.workspace.classList.toggle('navigator-collapsed', s.collapsed);
    collapse.title = s.collapsed ? 'Expand navigator' : 'Collapse navigator';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.innerHTML = s.collapsed
      ? svg(['M8.5 3.5a5 5 0 1 0 0 10a5 5 0 1 0 0-10', 'M12.2 12.2 16.5 16.5'])
      : svg(['M12.5 4.5 7 10l5.5 5.5']);
    const nav = s.view === 'nav';
    back.hidden = fwd.hidden = up.hidden = home.hidden = !nav;
    reveal.hidden = s.mode !== 'machine';
    paste.hidden = s.mode === 'machine';
  }
  function setMode(mode) {
    s.mode = mode;
    syncChrome();
    render();
  }
  function setView(view, renderNow = true) {
    s.view = view === 'nav' ? 'nav' : 'tree';
    persistUi('papers:ayg:navigator-view', s.view);
    syncChrome();
    if (renderNow) render();
  }
  function persistUi(key, value) {
    try { d.defaultView?.localStorage?.setItem(key, String(value)); } catch { /* optional */ }
  }
  function clearSearch({ renderNow = true } = {}) {
    if (s.searchTimer) clearTimeout(s.searchTimer);
    s.searchTimer = null;
    s.searchQuery = '';
    s.searchResult = null;
    s.searchFilters = { name:'', path:'', type:'', size:'', modified:'' };
    ++s.searchGeneration;
    if (searchInput.value) searchInput.value = '';
    if (renderNow) render();
  }
  async function switchProvider() {
    if (s.mode === 'machine') {
      clearSearch({ renderNow: false });
      setMode('ayg');
      return;
    }
    let root = s.machineRoot;
    if (root) {
      const stat = await o.host.fileCapability('stat', { path: root }).catch(() => null);
      if (!stat?.ok || stat.entry?.kind !== 'folder') root = null;
    }
    if (!root) {
      const picked = await o.host.pickTarget('folder').catch(() => null);
      root = typeof picked === 'string' ? picked : picked?.path || picked?.target || null;
    }
    if (!root || !o.isAbsoluteWindowsPath(root)) return;
    clearSearch({ renderNow: false });
    await enterMachine(root, false);
  }
  function setLocation(segments) {
    const key = segments.map((segment) => segment.key || segment.label).join('\u0000');
    locTrack.replaceChildren();
    segments.forEach((segment, index) => {
      if (index > 0) {
        const separator = d.createElement('span');
        separator.className = 'workspace-navigator-location-separator';
        separator.textContent = '›';
        locTrack.append(separator);
      }
      const crumb = d.createElement('button');
      crumb.type = 'button';
      crumb.className = 'workspace-navigator-crumb';
      crumb.textContent = segment.label;
      crumb.title = segment.title || segment.label;
      if (segment.activate) crumb.addEventListener('click', segment.activate);
      else crumb.disabled = true;
      locTrack.append(crumb);
    });
    if (key !== s.locationKey) {
      s.locationKey = key;
      d.defaultView?.requestAnimationFrame?.(() => { loc.scrollLeft = loc.scrollWidth; });
    }
  }
  loc.addEventListener('wheel', (event) => {
    if (loc.scrollWidth <= loc.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? -event.deltaY : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    loc.scrollBy({ left: delta, behavior: 'smooth' });
  }, { passive: false });
  const visibleIds=()=>[...body.querySelectorAll('[data-id]')].map((n)=>n.dataset.id).filter(Boolean);
  const currentAyG=()=>o.getSession().currentId||o.rootId;
  function navigateAyG(id,record=true){if(!record)s.aygSkipHistory=true;o.navigateAyG(id);}
  function aygCrumbs(){
    const groups=o.getState().groups||[],out=[];let id=currentAyG();
    while(id&&id!==o.rootId){const g=groups.find((x)=>x.id===id);if(!g)break;out.unshift({id:g.id,name:g.name});id=g.parentId;}
    return [{id:o.rootId,name:'As you Go'},...out];
  }
  async function enterAyG(x){
    if(x.kind==='group'){
      const nextView=s.view==='tree'?'nav':'tree';
      if(nextView==='tree'){
        let cursor=x;
        while(cursor&&cursor.id!==o.rootId){
          s.expanded.add(cursor.id);
          cursor=(o.getState().groups||[]).find((candidate)=>candidate.id===cursor.parentId);
        }
      }
      setView(nextView,false);
      navigateAyG(x.id);
      return;
    }
    if(!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target)){
      const stat=await o.host.fileCapability('stat',{path:x.target}).catch(()=>null);
      if(stat?.ok&&stat.entry?.kind==='folder'){await enterMachine(x.target,true);return;}
    }
    await o.activateAyG(x.shortcutId||x.id);render();
  }
  function aygChildren(parent, depth = 0) {
    const f = d.createDocumentFragment();
    for (const x of o.itemsIn(o.getState(), parent).filter((v) => v.kind !== 'window-layout')) {
      const id = x.id, row = d.createElement('div');
      row.className = 'workspace-navigator-row'; row.dataset.id = id; row.style.paddingLeft = `${4 + depth * 13}px`; row.classList.toggle('selected', o.getSession().selected.has(id));
      const ownNativePaths = o.nativeDragPaths?.([id]) || [];
      if (ownNativePaths.length > 0) {
        row.draggable = true;
        row.addEventListener('dragstart', (event) => {
          beginNavigatorNativeDrag({
            event,
            paths: aygNavigatorNativePaths({
              itemId: id,
              selectedIds: o.getSession().selected,
              resolvePaths: o.nativeDragPaths,
            }),
            host: o.host,
          });
        });
      }
      if (x.kind === 'group' && s.view === 'tree') {
        const t = d.createElement('button'); t.type='button'; t.className='navigator-tree-toggle'; t.textContent=s.expanded.has(x.id)?'▾':'▸';
        t.addEventListener('click',(e)=>{e.stopPropagation(); s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id); render();}); row.append(t);
      } else { const sp=d.createElement('span'); sp.className='navigator-tree-spacer'; row.append(sp); }
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      hydrateArt(art, x);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name||'Untitled'; row.append(art,label);
      row.addEventListener('click',(e)=>{if(e.shiftKey&&!e.ctrlKey){e.preventDefault();void enterAyG(x);return;}o.selectAyG(id,visibleIds(),{ctrlKey:e.ctrlKey});});
      row.addEventListener('contextmenu',(e)=>{
        if(!e.shiftKey||x.kind!=='group')return;
        e.preventDefault();e.stopPropagation();
        if(s.view==='nav'){
          let cursor=x;
          while(cursor&&cursor.id!==o.rootId){
            const parent=(o.getState().groups||[]).find((candidate)=>candidate.id===cursor.parentId);
            if(parent)s.expanded.add(parent.id);
            cursor=parent;
          }
          setView('tree',false);
        }
        s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id);
        render();
      });
      f.append(row); if (s.view==='tree'&&x.kind==='group'&&s.expanded.has(x.id)) f.append(aygChildren(x.id,depth+1));
    } return f;
  }
  function renderAyG() {
    if(s.view==='tree'){
      setLocation([{key:'ayg-root',label:'As you Go'}]);
      body.replaceChildren(aygChildren(o.rootId));
    }
    else{
      const current=currentAyG();
      if(s.aygSkipHistory)s.aygSkipHistory=false;else if(s.aygHistory[s.aygHi]!==current){s.aygHistory=s.aygHistory.slice(0,s.aygHi+1);s.aygHistory.push(current);s.aygHi=s.aygHistory.length-1;}
      setLocation(aygCrumbs().map((crumb)=>({
        key:crumb.id,
        label:crumb.name,
        activate:()=>navigateAyG(crumb.id),
      })));
      body.replaceChildren(aygChildren(current));
    }
    back.disabled=s.view!=='nav'||s.aygHi<=0;
    fwd.disabled=s.view!=='nav'||s.aygHi>=s.aygHistory.length-1;
    up.disabled=s.view!=='nav'||currentAyG()===o.rootId;
    home.disabled=s.view!=='nav'||currentAyG()===o.rootId;
    if (!body.childElementCount) body.innerHTML = '<p class="workspace-navigator-empty">Workspace is empty.</p>';
  }
  async function machineList(path, force = false) {
    const key = path.toLocaleLowerCase();
    if (!force && s.machineListings.has(key)) return s.machineListings.get(key);
    const pending = o.host.fileCapability('list', { path, limit: 500 })
      .catch((e) => ({ ok: false, message: String(e), items: [] }));
    s.machineListings.set(key, pending);
    return pending;
  }
  async function toggleMachine(path) {
    if (s.machineExpanded.has(path)) s.machineExpanded.delete(path);
    else { s.machineExpanded.add(path); await machineList(path); }
    render();
  }
  async function revealMachinePathInTree(path) {
    const root=s.machineRoot;
    if(!root)return;
    s.machineExpanded.add(root);
    let cursor=root.replace(/[\\/]+$/,'');
    const relative=path.slice(root.length).split(/[\\/]+/).filter(Boolean);
    for(const part of relative){
      cursor+='\\'+part;
      s.machineExpanded.add(cursor);
      await machineList(cursor);
    }
    s.path=path;
  }
  function formatSearchSize(value) {
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return `${value} B`;
    const units=['KB','MB','GB','TB'];
    let size=value/1024, unit=0;
    while(size>=1024&&unit<units.length-1){size/=1024;unit++;}
    return `${size>=100?Math.round(size):size>=10?size.toFixed(1):size.toFixed(2)} ${units[unit]}`;
  }
  function formatSearchDate(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    try {
      return new Date(value).toLocaleString([], { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch { return ''; }
  }
  function searchTypeLabel(item) {
    if (item.kind === 'folder') return 'Folder';
    const match = /(?:^|[\\/])([^\\/]+)$/.exec(item.path || '');
    const name = match?.[1] || item.name || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLocaleLowerCase() : 'File';
  }
  function parseSizeFilter(raw) {
    const match = String(raw || '').trim().toLocaleLowerCase().match(/^\s*(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/);
    if (!match) return null;
    const multipliers={b:1,kb:1024,mb:1024**2,gb:1024**3,tb:1024**4};
    return { op:match[1]||'>=', bytes:Number(match[2])*(multipliers[match[3]||'b']||1) };
  }
  function matchesSizeFilter(value, raw) {
    if (!String(raw || '').trim()) return true;
    if (!Number.isFinite(value) || value < 0) return false;
    const parsed=parseSizeFilter(raw);
    if(!parsed)return formatSearchSize(value).toLocaleLowerCase().includes(String(raw).trim().toLocaleLowerCase());
    if(parsed.op==='<')return value<parsed.bytes;
    if(parsed.op==='<=')return value<=parsed.bytes;
    if(parsed.op==='>')return value>parsed.bytes;
    if(parsed.op==='=')return value===parsed.bytes;
    return value>=parsed.bytes;
  }
  function filteredSearchResults() {
    const source=[...(s.searchResult?.results||[])], filters=s.searchFilters;
    const contains=(value,needle)=>!needle||String(value||'').toLocaleLowerCase().includes(String(needle).toLocaleLowerCase());
    const filtered=source.filter((item)=>{
      const parent=parentPath(item.path);
      const type=searchTypeLabel(item);
      const modified=formatSearchDate(item.modifiedAt);
      return contains(item.name,filters.name)
        && contains(parent,filters.path)
        && contains(type,filters.type)
        && matchesSizeFilter(item.size,filters.size)
        && contains(modified,filters.modified);
    });
    const {key,direction}=s.searchSort;
    if(!key)return filtered;
    const value=(item)=>{
      if(key==='path')return parentPath(item.path).toLocaleLowerCase();
      if(key==='type')return searchTypeLabel(item).toLocaleLowerCase();
      if(key==='size')return Number.isFinite(item.size)?item.size:-1;
      if(key==='modified')return Number.isFinite(item.modifiedAt)?item.modifiedAt:-1;
      return String(item.name||'').toLocaleLowerCase();
    };
    filtered.sort((a,b)=>{
      const av=value(a),bv=value(b);
      return (typeof av==='number'&&typeof bv==='number' ? av-bv : String(av).localeCompare(String(bv))) * direction;
    });
    return filtered;
  }
  function machineSortValue(item, key) {
    if (key === 'type') return searchTypeLabel(item).toLocaleLowerCase();
    if (key === 'size') return Number.isFinite(item.size) ? item.size : -1;
    if (key === 'modified') return Number.isFinite(item.modifiedAt) ? item.modifiedAt : -1;
    return String(item.name || '').toLocaleLowerCase();
  }
  function sortedMachineItems(items) {
    const { key, direction } = s.machineSort;
    return [...(items || [])].sort((a, b) => {
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (a.kind !== 'folder' && b.kind === 'folder') return 1;
      const av = machineSortValue(a, key), bv = machineSortValue(b, key);
      const compared = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (compared) return compared * direction;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  function machineColumnHeader() {
    const header=d.createElement('div'); header.className='workspace-navigator-machine-columns';
    const iconSpacer=d.createElement('span'); iconSpacer.className='workspace-navigator-machine-column-icon';
    header.append(iconSpacer);
    for (const [key,label] of [['name','Name'],['type','Type'],['size','Size'],['modified','Date Modified']]) {
      const sort=d.createElement('button'); sort.type='button'; sort.className='workspace-navigator-machine-sort';
      sort.textContent=label+(s.machineSort.key===key?(s.machineSort.direction===1?' ↑':' ↓'):'');
      sort.title=`Sort by ${label}`;
      sort.addEventListener('click',()=>{
        if(s.machineSort.key===key)s.machineSort.direction*=-1;
        else s.machineSort={key,direction:1};
        if(s.path)void loadMachine(s.path,false);
      });
      header.append(sort);
    }
    return header;
  }
  function searchColumnHeader() {
    const header=d.createElement('div'); header.className='workspace-navigator-search-columns';
    const iconSpacer=d.createElement('span'); iconSpacer.className='workspace-navigator-search-column-icon';
    header.append(iconSpacer);
    const specs=[
      ['name','Name','name'],
      ['path','Path','path contains…'],
      ['type','Type','folder / .rvt'],
      ['size','Size','>10mb'],
      ['modified','Date Modified','date contains…'],
    ];
    for(const [key,label,placeholder] of specs){
      const column=d.createElement('div'); column.className='workspace-navigator-search-column'; column.dataset.column=key;
      const sort=d.createElement('button'); sort.type='button'; sort.className='workspace-navigator-search-sort';
      sort.textContent=label+(s.searchSort.key===key?(s.searchSort.direction===1?' ↑':' ↓'):'');
      sort.title=`Sort by ${label}`;
      sort.addEventListener('click',()=>{
        if(s.searchSort.key===key)s.searchSort.direction*=-1;
        else s.searchSort={key,direction:1};
        renderSearch();
      });
      const input=d.createElement('input'); input.type='search'; input.value=s.searchFilters[key]||''; input.placeholder=placeholder; input.autocomplete='off'; input.spellcheck=false;
      input.setAttribute('aria-label',`Filter ${label}`);
      input.addEventListener('input',()=>{s.searchFilters[key]=input.value;renderSearch({preserveFocus:key});});
      column.append(sort,input); header.append(column);
    }
    return header;
  }
  function machineRow(x, depth = 0, { searchResult = false } = {}) {
    const row=d.createElement('div'); row.className='workspace-navigator-row machine-row'; row.style.paddingLeft=`${4+depth*13}px`; row.classList.toggle('selected',s.selected?.path===x.path);
    row.classList.toggle('search-result',searchResult);
    row.draggable = true;
    row.title = x.path;
    row.addEventListener('dragstart',(event)=>{
      beginNavigatorNativeDrag({ event, paths: [x.path], host: o.host });
    });
    const folder=x.kind==='folder', lead=d.createElement(folder&&s.view==='tree'?'button':'span'); lead.className=folder&&s.view==='tree'?'navigator-tree-toggle':'navigator-tree-spacer';
    if(folder&&s.view==='tree'){lead.type='button';lead.textContent=s.machineExpanded.has(x.path)?'▾':'▸';lead.addEventListener('click',(e)=>{e.stopPropagation();void toggleMachine(x.path);});}
    const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x); hydrateMachineArt(art,x);
    const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name; row.append(lead,art,label);
    if(!searchResult&&s.view==='nav'){
      row.classList.add('machine-list-row');
      const type=d.createElement('span'); type.className='workspace-navigator-machine-type'; type.textContent=searchTypeLabel(x);
      const size=d.createElement('span'); size.className='workspace-navigator-machine-size'; size.textContent=x.kind==='folder'?'':formatSearchSize(x.size);
      const modified=d.createElement('span'); modified.className='workspace-navigator-machine-modified'; modified.textContent=formatSearchDate(x.modifiedAt);
      row.append(type,size,modified);
    }
    if(searchResult){
      row.replaceChildren(art,label);
      const where=d.createElement('span'); where.className='workspace-navigator-search-path'; where.textContent=parentPath(x.path);
      const type=d.createElement('span'); type.className='workspace-navigator-search-type'; type.textContent=searchTypeLabel(x);
      const size=d.createElement('span'); size.className='workspace-navigator-search-size'; size.textContent=x.kind==='folder'?'':formatSearchSize(x.size);
      const modified=d.createElement('span'); modified.className='workspace-navigator-search-modified'; modified.textContent=formatSearchDate(x.modifiedAt);
      row.append(where,type,size,modified);
    }
    row.addEventListener('click',(e)=>{
      if(e.shiftKey&&!e.ctrlKey){
        e.preventDefault();
        if(folder){
          const nextView=s.view==='tree'?'nav':'tree';
          setView(nextView,false);
          if(searchResult){
            clearSearch({renderNow:false});
            void enterMachine(x.path,false);
          }else if(nextView==='nav')void loadMachine(x.path,true);
          else void revealMachinePathInTree(x.path).then(()=>render());
        }else{
          void o.host.fileCapability('open',{path:x.path});
        }
        return;
      }
      if(searchResult&&s.mode!=='machine'){
        s.mode='machine';
        if(!s.machineRoot){
          s.machineRoot=folder?x.path:parentPath(x.path);
          persistUi('papers:ayg:navigator-machine-root',s.machineRoot);
        }
        syncChrome();
      }
      s.selected=x;
      body.querySelectorAll('.machine-row.selected').forEach((candidate)=>candidate.classList.remove('selected'));
      row.classList.add('selected');
      o.clearCanvasForMachine();
      o.previewMachinePath(x.path,x.name);
    });
    row.addEventListener('dblclick',(e)=>{
      if(e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      if(folder){
        clearSearch({renderNow:false});
        setView('nav',false);
        if(searchResult||s.mode!=='machine')void enterMachine(x.path,false);
        else void loadMachine(x.path,true);
      }else{
        void o.host.fileCapability('open',{path:x.path});
      }
    });
    row.addEventListener('contextmenu',(e)=>{
      if(!e.shiftKey||!folder)return;
      e.preventDefault();e.stopPropagation();
      if(s.view==='nav'){
        let ancestor=parentPath(x.path), root=s.machineRoot?.toLocaleLowerCase();
        while(ancestor&&root&&ancestor.toLocaleLowerCase().startsWith(root)){s.machineExpanded.add(ancestor);if(ancestor.toLocaleLowerCase()===root)break;const next=parentPath(ancestor);if(!next||next===ancestor)break;ancestor=next;}
        setView('tree',false);
      }
      void toggleMachine(x.path);
    });
    return row;
  }
  async function machineTree(path, depth, generation) {
    const fragment=d.createDocumentFragment(), result=await machineList(path);
    if(generation!==s.renderGen||s.mode!=='machine'||s.view!=='tree'||!result?.ok)return fragment;
    for(const x of result.items||[]){fragment.append(machineRow(x,depth));if(x.kind==='folder'&&s.machineExpanded.has(x.path))fragment.append(await machineTree(x.path,depth+1,generation));}
    return fragment;
  }
  async function renderMachineTree() {
    const generation=++s.renderGen, root=s.machineRoot; if(!root)return;
    setLocation([{key:root.toLocaleLowerCase(),label:root,title:root}]);
    const fragment=d.createDocumentFragment(); fragment.append(machineRow({path:root,name:root,kind:'folder'}));
    if(s.machineExpanded.has(root))fragment.append(await machineTree(root,1,generation));
    if(generation===s.renderGen&&s.mode==='machine'&&s.view==='tree')body.replaceChildren(fragment);
  }
  function machinePathCrumbs(path) {
    const normalized=String(path||'').replace(/\//g,'\\').replace(/\\+$/,'');
    const unc=normalized.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/);
    if(unc){
      let cursor=`\\\\${unc[1]}\\${unc[2]}`;
      const entries=[{path:cursor,name:cursor}];
      for(const part of String(unc[3]||'').split('\\').filter(Boolean)){cursor+='\\'+part;entries.push({path:cursor,name:part});}
      return entries;
    }
    const drive=normalized.match(/^([A-Za-z]:)(?:\\(.*))?$/);
    if(drive){
      let cursor=drive[1]+'\\';
      const entries=[{path:cursor,name:cursor}];
      for(const part of String(drive[2]||'').split('\\').filter(Boolean)){cursor+=part;entries.push({path:cursor,name:part});cursor+='\\';}
      for(let i=1;i<entries.length;i++)entries[i].path=entries[i].path.replace(/\\+$/,'');
      return entries;
    }
    return [{path:normalized,name:normalized}];
  }
  function renderMachineCrumbs(path) {
    setLocation(machinePathCrumbs(path).map((entry)=>({
      key:entry.path.toLocaleLowerCase(),
      label:entry.name,
      title:entry.path,
      activate:()=>void loadMachine(entry.path,true),
    })));
  }
  async function loadMachine(path, push = true) {
    s.path = path;
    if (push && s.history[s.hi]?.toLocaleLowerCase() !== path.toLocaleLowerCase()) {
      s.history = s.history.slice(0, s.hi + 1);
      s.history.push(path);
      s.hi = s.history.length - 1;
    }
    if (s.view !== 'nav' || s.mode !== 'machine') return;
    const gen = ++s.renderGen; renderMachineCrumbs(path);
    body.innerHTML = '<p class="workspace-navigator-empty">Loading…</p>';
    const result = await machineList(path);
    if (gen !== s.renderGen || s.mode !== 'machine' || s.view !== 'nav' || s.path !== path) return;
    if (!result?.ok) { body.innerHTML = `<p class="workspace-navigator-empty">${result?.message || 'Could not list this folder.'}</p>`; return; }
    back.disabled=s.hi<=0; fwd.disabled=s.hi>=s.history.length-1; up.disabled=parentPath(path).toLowerCase()===path.toLowerCase();
    body.replaceChildren();
    const items=sortedMachineItems(result.items || []);
    if(items.length){
      body.append(machineColumnHeader());
      const rows=d.createElement('div'); rows.className='workspace-navigator-machine-rows';
      for (const x of items) rows.append(machineRow(x));
      body.append(rows);
    }else body.innerHTML='<p class="workspace-navigator-empty">This folder is empty.</p>';
  }
  async function enterMachine(path, fromGesture = false) {
    const changed = !s.path || !s.machineRoot || s.machineRoot.toLocaleLowerCase() !== path.toLocaleLowerCase();
    if (changed) {
      s.machineRoot = path; s.path = path; s.selected = null;
      s.history = [path]; s.hi = 0;
      s.machineExpanded = new Set([path]);
      s.machineListings.clear();
    }
    persistUi('papers:ayg:navigator-machine-root', s.machineRoot);
    s.mode = 'machine';
    if (fromGesture) setView(s.view==='tree'?'nav':'tree', false);
    syncChrome();
    if (s.view === 'nav') await loadMachine(path, false);
    else render();
  }
  async function syncCanvasSelection(selection) {
    if (selection?.mode === 'empty' && selection.selectionCount === 0) {
      if (s.mode === 'ayg') render();
      return;
    }
    const gen=++s.gen, path=selection?.mode==='single'?selection.item?.path:null;
    if (!path || !o.isAbsoluteWindowsPath(path)) { if(s.mode!=='ayg') setMode('ayg'); else render(); return; }
    const result=await o.host.fileCapability('stat',{path}).catch(()=>null); if(gen!==s.gen) return;
    if(result?.ok && result.entry?.kind==='folder') return enterMachine(path, false);
    if(s.mode!=='ayg') setMode('ayg'); else render();
  }
  function renderSearch({preserveFocus=null} = {}) {
    setLocation([{key:'everything',label:'Everything'},{key:s.searchQuery,label:s.searchQuery}]);
    body.replaceChildren();
    if (!s.searchResult) {
      searchInfo.textContent = 'Everything · searching…';
      body.innerHTML = '<p class="workspace-navigator-empty">Searching…</p>';
      return;
    }
    if (!s.searchResult.ok) {
      searchInfo.textContent = s.searchResult.message || s.searchResult.error || 'Everything unavailable';
      body.innerHTML = `<p class="workspace-navigator-empty">${s.searchResult.message || s.searchResult.error || 'Everything search is unavailable.'}</p>`;
      return;
    }
    const shown = (s.searchResult.results || []).length;
    const total = Number.isFinite(s.searchResult.total) ? s.searchResult.total : shown;
    const filtered=filteredSearchResults();
    const version = s.searchResult.version ? ` ${s.searchResult.version}` : '';
    searchInfo.textContent = `Everything${version} · ${total.toLocaleString()} result${total===1?'':'s'} · ${shown.toLocaleString()} loaded${filtered.length!==shown?` · ${filtered.length.toLocaleString()} visible`:''}`;
    body.append(searchColumnHeader());
    const rows=d.createElement('div'); rows.className='workspace-navigator-search-rows';
    for (const item of filtered) rows.append(machineRow(item, 0, { searchResult: true }));
    if (!rows.childElementCount) rows.innerHTML = '<p class="workspace-navigator-empty">No results match these column filters.</p>';
    body.append(rows);
    if(preserveFocus){
      const active=body.querySelector(`.workspace-navigator-search-column[data-column="${preserveFocus}"] input`);
      active?.focus();
      active?.setSelectionRange?.(active.value.length,active.value.length);
    }
  }
  async function runSearch(query) {
    const normalized=String(query||'').trim();
    s.searchQuery=normalized;
    s.searchResult=null;
    const generation=++s.searchGeneration;
    if(!normalized){render();return;}
    renderSearch();
    const result=await o.host.fileCapability('search',{query:normalized,limit:1000}).catch((error)=>({ok:false,message:error instanceof Error?error.message:String(error),results:[]}));
    if(generation!==s.searchGeneration||s.searchQuery!==normalized)return;
    s.searchResult=result;
    renderSearch();
  }
  const destination=()=>{const ids=[...o.getSession().selected]; return ids.length===1&&o.getState().groups.some((g)=>g.id===ids[0])?ids[0]:(o.getSession().currentId||o.rootId);};
  provider.addEventListener('click',()=>{void switchProvider();});
  searchInput.addEventListener('input',()=>{
    if(s.searchTimer)clearTimeout(s.searchTimer);
    s.searchTimer=setTimeout(()=>{s.searchTimer=null;void runSearch(searchInput.value);},120);
  });
  searchInput.addEventListener('keydown',(event)=>{
    if(event.key==='Escape'&&searchInput.value){event.preventDefault();clearSearch();}
  });
  viewToggle.addEventListener('click',()=>setView(s.view==='tree'?'nav':'tree'));
  function setCollapsed(collapsed){
    s.collapsed=Boolean(collapsed);
    persistUi('papers:ayg:navigator-collapsed',s.collapsed?'1':'0');
    render();
  }
  collapse.addEventListener('click',()=>setCollapsed(!s.collapsed));
  resizer.addEventListener('pointerdown',(e)=>{if(e.button!==0||s.collapsed)return;resizer.setPointerCapture?.(e.pointerId);panel.classList.add('resizing');e.preventDefault();});
  resizer.addEventListener('pointermove',(e)=>{
    if(!resizer.hasPointerCapture?.(e.pointerId)||s.collapsed)return;
    const width=Math.max(176,Math.min(d.defaultView.innerWidth*.55,e.clientX-panel.getBoundingClientRect().left));
    s.width=Math.round(width);
    o.workspace.style.setProperty('--workspace-navigator-width',s.width+'px');
    e.preventDefault();
  });
  const finishResize=(e)=>{
    if(!resizer.hasPointerCapture?.(e.pointerId))return;
    resizer.releasePointerCapture?.(e.pointerId);
    panel.classList.remove('resizing');
    persistUi('papers:ayg:navigator-width',s.width);
  };
  resizer.addEventListener('pointerup',finishResize);resizer.addEventListener('pointercancel',finishResize);
  back.addEventListener('click',()=>{
    if(s.mode==='ayg'){if(s.aygHi<=0)return;s.aygHi--;navigateAyG(s.aygHistory[s.aygHi],false);return;}
    if(s.hi>0){s.hi--;void loadMachine(s.history[s.hi],false);}
  });
  fwd.addEventListener('click',()=>{
    if(s.mode==='ayg'){if(s.aygHi>=s.aygHistory.length-1)return;s.aygHi++;navigateAyG(s.aygHistory[s.aygHi],false);return;}
    if(s.hi<s.history.length-1){s.hi++;void loadMachine(s.history[s.hi],false);}
  });
  up.addEventListener('click',()=>{
    if(s.mode==='ayg'){const g=o.getState().groups.find((x)=>x.id===currentAyG());navigateAyG(g?.parentId||o.rootId);return;}
    const p=parentPath(s.path);if(p&&p.toLocaleLowerCase()!==s.path.toLocaleLowerCase())void loadMachine(p,true);
  });
  home.addEventListener('click',()=>{if(s.mode==='ayg')navigateAyG(o.rootId);else if(s.machineRoot)void loadMachine(s.machineRoot,true);});
  refresh.addEventListener('click',()=>{if(s.mode==='machine'&&s.path)s.machineListings.delete(s.path.toLocaleLowerCase());render();});
  copy.addEventListener('click',async()=>{if(s.mode==='ayg')return o.copyAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst){const r=await o.host.fileCapability('copy',{paths:[s.selected.path],destination:dst});if(!r?.ok){o.setStatus(r?.message||'Copy failed.');return;}s.machineListings.clear();render();}});
  move.addEventListener('click',async()=>{if(s.mode==='ayg')return o.cutAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst){const r=await o.host.fileCapability('move',{paths:[s.selected.path],destination:dst});if(!r?.ok){o.setStatus(r?.message||'Move failed.');return;}s.selected=null;s.machineListings.clear();render();}});
  paste.addEventListener('click',()=>o.pasteAyG(destination()));
  rename.addEventListener('click',async()=>{if(s.mode==='ayg')return o.renameAyG();if(!s.selected)return;const n=d.defaultView?.prompt('Rename',s.selected.name)?.trim();if(n&&n!==s.selected.name){const r=await o.host.fileCapability('rename',{path:s.selected.path,newName:n});if(!r?.ok){o.setStatus(r?.message||'Rename failed.');return;}s.selected=null;s.machineListings.clear();render();}});
  del.addEventListener('click',async()=>{if(s.mode==='ayg')return o.deleteAyG();if(!s.selected||!d.defaultView?.confirm(`Move "${s.selected.name}" to Recycle Bin?`))return;const r=await o.host.fileCapability('delete',{paths:[s.selected.path]});if(!r?.ok){o.setStatus(r?.message||'Delete failed.');return;}s.selected=null;s.machineListings.clear();render();});
  reveal.addEventListener('click',()=>{const p=s.selected?.path||s.path;if(p)void o.host.fileCapability('reveal',{path:p});});
  function render(){
    syncChrome();
    if (s.collapsed) return;
    if(s.searchQuery){renderSearch();return;}
    searchInfo.textContent = '';
    if(s.mode==='ayg')renderAyG();
    else if(s.view==='tree')void renderMachineTree();
    else if(s.path)void loadMachine(s.path,false);
  }
  syncChrome(); render();
  return Object.freeze({
    render,
    syncCanvasSelection,
    isMachineMode: () => s.mode === 'machine',
    isCollapsed: () => s.collapsed,
    setCollapsed,
  });
}