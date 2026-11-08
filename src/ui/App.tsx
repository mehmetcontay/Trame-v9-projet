// Application : barre supérieure, bibliothèque, canevas, inspecteur, terminaux, simulation, cours.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, LinkEnd } from '../model/types';
import { createProject, addDevice, connect, removeDevice, removeLink, getDevice } from '../model/project';
import { sampleProject } from '../model/sample';
import { EXAMPLES } from '../model/examples';
import { MODELS, getModel, DeviceModel } from '../devices/catalog';
import { cloneDevice, nextName, uid } from '../devices/factory';
import { createRuntime, Runtime } from '../sim/runtime';
import { dhcpRenew } from '../sim/dhcp';
import { createShell, Shell } from '../cli';
import { serializeProject, parseProject, isPacketTracerFile, FILE_EXT, ProjectFormatError } from '../storage/serialize';
import { ProjectStore, IdbKV, MemoryKV } from '../storage/store';
import { getExercise } from '../learn/exercises';
import { Canvas, CanvasApi, Sel, Anim } from './Canvas';
import { Inspector } from './Inspector';
import { TerminalDock } from './Terminal';
import { SimPanel } from './SimPanel';
import { LearnDialog, ExerciseCard } from './Learn';
import { UnsavedDialog, ProjectsDialog, PktDialog, ConfirmChoice, ModalForm } from './Dialogs';
import { Icon, DeviceIcon, Logo } from './icons';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';

type Theme = 'light' | 'dark';
type Toast = { id: number; text: string; kind?: 'ok' | 'err' };
type Modal =
  | { type: 'unsaved'; action: string; then: () => void }
  | { type: 'projects'; list: { id: string; name: string; updatedAt: number }[] | null }
  | { type: 'pkt'; name: string }
  | { type: 'form'; then: () => void }
  | { type: 'learn'; tab?: 'cours' | 'exercices' }
  | null;

function initialTheme(): Theme {
  try { const t = localStorage.getItem('trame.theme'); if (t === 'light' || t === 'dark') return t; } catch { /* */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function makeStore(): { store: ProjectStore; persistent: boolean } {
  try { if (typeof indexedDB !== 'undefined') return { store: new ProjectStore(new IdbKV()), persistent: true }; } catch { /* */ }
  return { store: new ProjectStore(new MemoryKV()), persistent: false };
}
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App() {
  const [project, setProject] = useState<Project>(() => createProject());
  const projectRef = useRef(project);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [selections, setSelections] = useState<Sel[]>([]);
  const sel = selections.length === 1 ? selections[0] : null;
  const setSel = useCallback((s: Sel | null) => setSelections(s ? [s] : []), []);
  const [tool, setTool] = useState<'select' | 'cable'>('select');
  const [mode, setMode] = useState<'design' | 'sim'>('design');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(true);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exerciseHidden, setExerciseHidden] = useState(false);
  const [welcomeClosed, setWelcomeClosed] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [desktopLib, setDesktopLib] = useState(true);
  const [desktopInsp, setDesktopInsp] = useState(true);
  const [inspTab, setInspTab] = useState('overview');
  const [formDirty, setFormDirty] = useState(false);
  const form = useRef<{apply: () => boolean; discard: () => void} | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const registerForm = useCallback((v: {apply: () => boolean; discard: () => void} | null) => { form.current = v; setFormDirty(!!v); }, []);
  const guardForm = useCallback((then: () => void) => { if (form.current) setModal({type:'form', then}); else then(); }, []);
  const onPrinting = useCallback((id:string) => { setPrintingId(id); window.setTimeout(() => setPrintingId(current => current === id ? null : current), 2000); }, []);
  const [epoch, setEpoch] = useState(0);
  const [panels, setPanels] = useState<{ lib: boolean; insp: boolean }>({ lib: false, insp: false });
  const [bannerOff, setBannerOff] = useState(() => { try { return localStorage.getItem('trame.storageInfo') === 'ok'; } catch { return false; } });
  const shells = useRef(new Map<string, Shell>());
  const rt = useRef<Runtime>(createRuntime());
  const canvas = useRef<CanvasApi>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const storeInfo = useMemo(makeStore, []);

  // ---------- thème ----------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('trame.theme', theme); } catch { /* */ }
  }, [theme]);

  // ---------- notifications ----------
  const toast = useCallback((text: string, kind?: 'ok' | 'err') => {
    const id = Date.now() + Math.random();
    setToasts([{ id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 5200 : 3200);
  }, []);

  // ---------- modifications du projet ----------
  const commit = useCallback((np: Project) => { projectRef.current = np; setProject(np); dirtyRef.current=true; setDirty(true); }, []);
  const mutate = useCallback((f: (p: Project) => void) => {
    const np = structuredClone(projectRef.current);
    try { f(np); } catch (e) { toast((e as Error).message, 'err'); return; }
    np.updatedAt = Date.now();
    commit(np);
  }, [commit, toast]);

  const loadProject = useCallback((p: Project, isDirty = false) => {
    projectRef.current = p; setProject(p); dirtyRef.current=isDirty; setDirty(isDirty);
    shells.current.clear(); rt.current = createRuntime();
    setExerciseHidden(false);
    setTabs([]); setActiveTab(null); setDockCollapsed(true); setSel(null); setAnim(null); setTool('select'); setInspTab('overview');
    setEpoch((e) => e + 1);
    setTimeout(() => canvas.current?.fit(), 30);
  }, []);

  const getShell = useCallback((id: string): Shell | null => {
    const d = getDevice(projectRef.current, id);
    if (d && ['bridge', 'filter'].includes(getModel(d.modelId).os ?? '')) return null;
    if (!d) { shells.current.delete(id); return null; }
    let s = shells.current.get(id);
    if (!s) {
      s = createShell(d, { get: () => projectRef.current, set: commit, rt: rt.current, deviceId: id });
      shells.current.set(id, s);
    }
    return s;
  }, [commit]);

  // ---------- garde « modifications non enregistrées » ----------
  const guard = useCallback((action: string, then: () => void) => {
    guardForm(() => { if (dirtyRef.current) setModal({ type: 'unsaved', action, then }); else then(); });
  }, [dirty, guardForm]);

  const save = useCallback(async (): Promise<boolean> => {
    try {
      await storeInfo.store.save(projectRef.current);
      dirtyRef.current=false; setDirty(false); setSavedOnce(true);
      toast(storeInfo.persistent ? 'Projet enregistré dans ce navigateur.' : 'Enregistré pour cette session seulement (stockage local indisponible) : exportez le fichier.', storeInfo.persistent ? 'ok' : 'err');
      return true;
    } catch (e) {
      toast(`Échec de l’enregistrement : ${(e as Error).message}. Exportez le projet en fichier.`, 'err');
      return false;
    }
  }, [storeInfo, toast]);

  function exportFile() {
    const p = projectRef.current;
    const blob = new Blob([serializeProject(p)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (p.name.trim() || 'projet').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + FILE_EXT;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Fichier exporté.', 'ok');
  }
  async function onFile(f: File) {
    if (isPacketTracerFile(f.name)) { setModal({ type: 'pkt', name: f.name }); return; }
    try {
      const p = parseProject(await f.text());
      p.id = uid('prj');
      guard('importer ce fichier', () => { loadProject(p, true); setModal(null); toast(`« ${p.name} » importé. Enregistrez-le pour le garder dans ce navigateur.`, 'ok'); });
    } catch (e) {
      toast(e instanceof ProjectFormatError ? `Fichier refusé : ${e.message}` : 'Ce fichier n’est pas un projet Trame valide (JSON illisible).', 'err');
    }
  }
  async function openProjects() {
    setModal({ type: 'projects', list: null });
    try { setModal({ type: 'projects', list: await storeInfo.store.list() }); }
    catch (e) { setModal(null); toast(`Lecture impossible : ${(e as Error).message}`, 'err'); }
  }
  function openStored(id: string) {
    guard('ouvrir un autre projet', async () => {
      try { const p = await storeInfo.store.load(id); loadProject(p); setSavedOnce(true); setModal(null); toast(`« ${p.name} » ouvert.`); }
      catch (e) { toast(`Ouverture impossible : ${(e as Error).message}`, 'err'); }
    });
  }
  const newProject = () => guard('créer un nouveau projet', () => { loadProject(createProject()); setSavedOnce(false); });
  const openSample = () => guard('ouvrir le projet d’exemple', () => { loadProject(sampleProject(), true); toast('Projet d’exemple chargé. Double-cliquez sur PC0 pour ouvrir son invite de commandes.'); });
  function openExample(id: string) { const e = EXAMPLES.find(x => x.id === id); if (!e) return; guard('ouvrir ce réseau', () => { loadProject(e.build(), true); setModal(null); setMode('design'); toast(e.test); }); }
  function startExercise(id: string) {
    const ex = getExercise(id); if (!ex) return;
    guard('commencer l’exercice', () => { loadProject(ex.build(), true); setModal(null); setMode('design'); });
  }

  // ---------- actions topologie ----------
  const addModel = useCallback((m: DeviceModel, x?: number, y?: number) => {
    if (!m.available) { toast(`${m.label} : ${m.summary} Pas encore simulé — bientôt disponible.`); return; }
    const c = canvas.current?.center() ?? { x: 300, y: 240 };
    const jitter = () => Math.round((Math.random() - 0.5) * 80);
    let newId = '';
    mutate((p) => { newId = addDevice(p, m.id, x ?? c.x + jitter(), y ?? c.y + jitter()).id; });
    if (newId) { setSel({ type: 'device', id: newId }); setInspTab('overview'); }
    setPanels((s) => ({ ...s, lib: false }));
  }, [mutate, toast]);

  const openTerminal = useCallback((id: string) => {
    const d = getDevice(projectRef.current, id);
    if (d?.poweredOn === false) { toast('Allumez cet équipement pour ouvrir son terminal.', 'err'); return; }
    if (!d || ['bridge', 'filter'].includes(getModel(d.modelId).os ?? '')) { toast('Cet équipement se configure sans terminal.'); return; }
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActiveTab(id); setDockCollapsed(false);
  }, [toast]);
  const closeTerminal = useCallback((id: string) => {
    setTabs((t) => { const n = t.filter((x) => x !== id); setActiveTab((a) => (a === id ? n[n.length - 1] ?? null : a)); return n; });
  }, []);

  const deleteSel = useCallback(() => {
    if (!selections.length) return;
    mutate((p) => {
      for (const s of selections) {
        if (s.type === 'device') removeDevice(p, s.id);
        else if (s.type === 'link') removeLink(p, s.id);
        else p.notes = p.notes.filter((n) => n.id !== s.id);
      }
    });
    for (const s of selections) if (s.type === 'device') { closeTerminal(s.id); shells.current.delete(s.id); }
    setSel(null);
  }, [selections, mutate, closeTerminal, setSel]);

  const duplicateSel = useCallback(() => {
    if (sel?.type !== 'device') return;
    let id = '';
    let duplicatedStaticIp = false;
    mutate((p) => {
      const d = getDevice(p, sel.id); if (!d) return;
      const c = cloneDevice(d, nextName(p, getModel(d.modelId).namePrefix));
      duplicatedStaticIp = !!c.config.host?.ip && c.config.host.mode === 'static';
      p.devices.push(c); id = c.id;
    });
    if (id) setSel({ type: 'device', id });
    if (duplicatedStaticIp) toast('La copie conserve l’adresse IP statique : modifiez-la pour éviter un conflit.', 'err');
  }, [sel, mutate, toast]);

  const addNote = useCallback(() => {
    const c = canvas.current?.center() ?? { x: 300, y: 200 };
    const id = uid('note');
    mutate((p) => { p.notes.push({ id, x: Math.round(c.x), y: Math.round(c.y), text: 'Nouvelle note' }); });
    setSel({ type: 'note', id });
  }, [mutate]);

  const onDhcp = useCallback((id: string) => {
    let msg = ''; let ok = false;
    mutate((p) => { const r = dhcpRenew(p, id); msg = r.message; ok = r.ok; });
    if (msg) toast(msg, ok ? 'ok' : 'err');
  }, [mutate, toast]);

  // ---------- raccourcis clavier ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardForm(() => { void save(); }); return; }
      if (modal || isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); guardForm(duplicateSel); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('select');
      else if ((k === 'c' || k === 'r') && mode === 'design') setTool('cable');
      else if (k === 'n' && mode === 'design') guardForm(addNote);
      else if (k === 'f') canvas.current?.fit();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selections.length && mode === 'design') { e.preventDefault(); guardForm(deleteSel); }
      else if (e.key === 'Escape') guardForm(() => { setSel(null); setTool('select'); });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, sel, selections, mode, save, duplicateSel, deleteSel, addNote, setSel]);

  // Le panneau de terminal réduit le plan : réajuster après ouverture/fermeture.
  useEffect(() => { const timer = setTimeout(() => canvas.current?.fit(), 60); return () => clearTimeout(timer); }, [dockCollapsed]);

  // ---------- quitter la page ----------
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty || formDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, formDirty]);

  // ---------- rendu ----------
  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const g = new Map<string, DeviceModel[]>();
    for (const m of MODELS) {
      if (!m.available) continue;
      if (q && !`${m.label} ${m.vendor} ${m.category} ${m.summary}`.toLowerCase().includes(q)) continue;
      if (!g.has(m.category)) g.set(m.category, []);
      g.get(m.category)!.push(m);
    }
    const order = ['Ordinateurs', 'Switchs', 'Serveurs', 'Imprimantes', 'Routeurs', 'Sans fil', 'Sécurité'];
    return [...g].sort((a,b) => order.indexOf(a[0])-order.indexOf(b[0]));
  }, [q]);

  const exId = project.exerciseId && getExercise(project.exerciseId) ? project.exerciseId : null;
  const empty = project.devices.length === 0 && project.notes.length === 0;
  const showBanner = !storeInfo.persistent || !bannerOff;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
        <button className="btn ghost icon" aria-label="Bibliothèque d’équipements" title="Afficher ou masquer les équipements" onClick={() => { if (window.innerWidth <= 900) setPanels((s) => ({ lib: !s.lib, insp: false })); else setDesktopLib(v => !v); }}><PanelLeftClose size={18} /></button>
        <div className="brand"><Logo /><span className="brand-name">Trame</span><small>simulateur réseau</small></div>
        <input className="project-name" aria-label="Nom du projet" size={Math.min(24, Math.max(10, project.name.length + 1))} value={project.name} onChange={(e) => mutate((p) => { p.name = e.target.value; })} />
        {dirty && <span className="dirty-dot" title="Modifications non enregistrées" aria-label="Modifications non enregistrées" />}
        <details className="file-menu"><summary className="btn">Fichier</summary><div className="filebar" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
          <button className="btn ghost" onClick={newProject} title="Nouveau projet"><Icon.filePlus size={16} /><span className="btn-label">Nouveau</span></button>
          <button className="btn ghost" onClick={openProjects} title="Ouvrir un projet enregistré"><Icon.folder size={16} /><span className="btn-label">Ouvrir</span></button>
          <button className="btn ghost" onClick={() => guardForm(() => { void save(); })} title="Enregistrer (Ctrl+S)"><Icon.save size={16} /><span className="btn-label">Enregistrer</span></button>
          <button className="btn ghost" onClick={() => guardForm(exportFile)} title="Exporter en fichier .trame.json"><Icon.download size={16} /><span className="btn-label">Exporter</span></button>
          <button className="btn ghost" onClick={() => fileInput.current?.click()} title="Importer un fichier"><Icon.upload size={16} /><span className="btn-label">Importer</span></button>
        </div></details>
        </div>
        <div className="segmented topbar-mode" role="tablist" aria-label="Mode">
          <button className={mode === 'design' ? 'on' : ''} onClick={() => guardForm(() => { setMode('design'); setAnim(null); setPanels({ lib: false, insp: false }); })}><Icon.cursor size={14} /><span className="btn-label">Conception</span></button>
          <button className={mode === 'sim' ? 'on' : ''} onClick={() => guardForm(() => { setMode('sim'); setTool('select'); setPanels({ lib: false, insp: true }); })}><Icon.packet size={14} /><span className="btn-label">Simulation</span></button>
        </div>
        <div className="topbar-right"><button className="btn learn-button" aria-label="Cours et exercices" onClick={() => guardForm(() => setModal({ type: 'learn' }))}><Icon.book size={16} /><span className="btn-label">Cours et exercices</span></button>
        <button className="btn ghost icon" aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'} title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Icon.sun size={17} /> : <Icon.moon size={17} />}</button>
        <button className="btn ghost icon" aria-label="Panneau de détails" title="Afficher ou masquer les détails" onClick={() => { if (window.innerWidth <= 900) setPanels((s) => ({ insp: !s.insp, lib: false })); else setDesktopInsp(v => !v); }}><PanelRightClose size={18} /></button>
        </div><input ref={fileInput} type="file" accept=".json,.trame.json,.pkt,.pka,.pkz,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      </header>

      <div className="below">
        {showBanner && (
          <div className="banner" role="note">
            <Icon.info size={16} />
            <span style={{ flex: 1 }}>{storeInfo.persistent
              ? <>Vos projets sont enregistrés <b>uniquement dans ce navigateur</b>. Effacer les données du site les supprime : exportez régulièrement vos projets importants.</>
              : <><b>Stockage local indisponible</b> (navigation privée ?) : rien ne sera conservé après fermeture. Utilisez « Exporter ».</>}</span>
            {storeInfo.persistent && <button className="btn ghost" onClick={() => { setBannerOff(true); try { localStorage.setItem('trame.storageInfo', 'ok'); } catch { /* */ } }}>J’ai compris</button>}
          </div>
        )}
        <main className={`main${desktopLib ? '' : ' hide-lib'}${desktopInsp ? '' : ' hide-insp'}`}>
          <aside className={`sidebar${panels.lib ? ' open' : ''}`} aria-label="Bibliothèque d’équipements">
            <div className="lib-search">{showSearch && <input type="search" placeholder="Rechercher un équipement…" aria-label="Rechercher un équipement" value={search} onChange={(e) => setSearch(e.target.value)} />}<button className="btn ghost icon" aria-label={showSearch ? 'Masquer la recherche' : 'Afficher la recherche'} title={showSearch ? 'Masquer la recherche' : 'Afficher la recherche'} onClick={() => {setShowSearch(!showSearch);setSearch('');}}>{showSearch ? <Icon.x size={15}/> : <Icon.search size={15}/>}</button></div>
            {groups.length === 0 && <p style={{ padding: '8px 16px', color: 'var(--text-2)' }}>Aucun équipement ne correspond.</p>}
            {groups.map(([cat, ms]) => (
              <div className="lib-group" key={cat}>
                <button className="lib-heading" aria-expanded={!collapsedGroups.includes(cat)} onClick={() => setCollapsedGroups(v => v.includes(cat) ? v.filter(x=>x!==cat) : [...v,cat])}><span>{cat}</span><span className={collapsedGroups.includes(cat) ? 'lib-chevron closed' : 'lib-chevron'}><Icon.chevron size={16} /></span></button>
                {!collapsedGroups.includes(cat) && <div className="lib-grid grid grid-cols-2 gap-1">{ms.map((m) => (
                  <button key={m.id} className={`lib-item${m.available ? '' : ' off'}`} draggable={m.available && mode === 'design'}
                    title={m.available ? `${m.summary} — glissez sur le plan ou cliquez pour ajouter` : `${m.summary} (bientôt)`}
                    onDragStart={(e) => { e.dataTransfer.setData('text/x-trame-model', m.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => guardForm(() => (mode === 'design' ? addModel(m) : toast('Passez en mode Conception pour ajouter des équipements.')))}>
                    <span className={`tile k-${m.kind}${m.vendor === 'Allied Telesis' ? ' at' : ''}`}><DeviceIcon kind={m.kind} modelId={m.id} size={36} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="t1" style={{ display: 'block' }}>{m.label}</span>
                      <span className="t2">{m.vendor}</span>
                    </span>
                    {!m.available && <span className="pill">Bientôt</span>}
                  </button>
                ))}</div>}
              </div>
            ))}

          </aside>

          <div className="center">
            <Canvas ref={canvas} key={`c${epoch}`} project={project} selection={selections}
              onSelect={(s, additive) => guardForm(() => { if (s && additive) setSelections((prev) => prev.some(x => x.type === s.type && x.id === s.id) ? prev.filter(x => x.type !== s.type || x.id !== s.id) : [...prev, s]); else setSel(s); if (s && !additive && window.innerWidth <= 900 && tool !== 'cable') setPanels({ lib: false, insp: true }); if (s) setInspTab('apercu'); })}
              onSelectMany={(items, additive) => guardForm(() => setSelections(prev => additive ? [...prev, ...items.filter(s => !prev.some(v => v.type === s.type && v.id === s.id))] : items))}
              onMove={(s, x, y) => mutate((p) => { const o = s.type === 'note' ? p.notes.find((n) => n.id === s.id) : getDevice(p, s.id); if (!o) return; const dx = x - o.x, dy = y - o.y; const group = selections.some(v => v.type === s.type && v.id === s.id) ? selections : [s]; for (const v of group) { const item = v.type === 'note' ? p.notes.find(n => n.id === v.id) : v.type === 'device' ? getDevice(p, v.id) : null; if (item) { item.x += dx; item.y += dy; } } })}
              tool={tool} editable={mode === 'design'} setTool={(t) => { if (mode === 'design' || t === 'select') setTool(t); }}
              onCreateLink={(a: LinkEnd, b: LinkEnd) => mutate((p) => { connect(p, a, b); })}
              onDropModel={(m, x, y) => { if (mode === 'design') guardForm(() => addModel(getModel(m), x, y)); }}
              onOpen={openTerminal} onAddNote={() => guardForm(addNote)} printingId={printingId} onContext={(action,id) => guardForm(() => { if (action === 'terminal') openTerminal(id); else if (action === 'ip') { setSel({type:'device',id}); setInspTab('ip'); setDesktopInsp(true); setPanels({lib:false,insp:true}); } else if (action === 'delete') deleteSel(); else setTool('cable'); })} anim={mode === 'sim' ? anim : null} padRight={0}>
              {empty && !welcomeClosed && (
                <div className="empty-state">
                  <div className="empty-card">
                    <button className="btn ghost icon welcome-close" aria-label="Fermer le message de bienvenue" onClick={() => setWelcomeClosed(true)}><Icon.x size={17} /></button>
                    <Logo size={44} />
                    <h2>Construisez votre premier réseau</h2>
                    <p>Glissez un PC, un switch ou un routeur depuis la bibliothèque, reliez-les avec « Relier », puis configurez-les.</p>
                    <div className="row">
                      <button className="btn primary" onClick={openSample}><Icon.sparkle size={16} />Projet d’exemple</button>
                      <button className="btn" onClick={() => setModal({ type: 'learn' })}><Icon.book size={16} />Cours et exercices</button>
                    </div>
                  </div>
                </div>
              )}
              {exId && exerciseHidden && <button className="btn exercise-reopen" onClick={() => setExerciseHidden(false)}><Icon.book size={16} />Afficher l’exercice</button>}
              {exId && <ExerciseCard key={`${exId}-${epoch}`} exId={exId} project={project} hidden={exerciseHidden}
                onClose={() => setExerciseHidden(true)}
                onRestart={() => guard('recommencer l’exercice', () => { const ex = getExercise(exId)!; loadProject(ex.build(), true); })}
                onNext={(id) => startExercise(id)} />}
            </Canvas>
            <TerminalDock key={`t${epoch}`} project={project} tabs={tabs} active={activeTab} setActive={setActiveTab} close={closeTerminal}
              getShell={getShell} collapsed={dockCollapsed} setCollapsed={setDockCollapsed}
              guardCommand={(line, run) => {
                // These host commands can change IP settings while the inspector contains an unapplied draft.
                if (/(?:^|[\r\n])\s*ipconfig\s+\/(?:renew|release)\b/i.test(line)) guardForm(run);
                else run();
              }} />
          </div>

          <aside className={`inspector${panels.insp ? ' open' : ''}`} aria-label={mode === 'sim' ? 'Simulation' : 'Détails'}>
            {mode === 'sim'
              ? <SimPanel key={`s${epoch}`} project={project} rt={rt.current} setAnim={setAnim} commit={commit} preferredSource={sel?.type === 'device' ? sel.id : null} />
              : selections.length > 1 ? <div className="panel stack"><h3>{selections.length} éléments sélectionnés</h3><p className="sub">Glissez un élément pour déplacer le groupe. Maj ou Ctrl + clic pour ajouter ou retirer un élément.</p><button className="btn danger" onClick={deleteSel}><Icon.trash size={16} />Supprimer la sélection</button></div> : <Inspector project={project} selection={sel} mutate={mutate} onOpenTerminal={openTerminal} onDuplicate={() => guardForm(duplicateSel)} onDelete={() => guardForm(deleteSel)} onDhcp={onDhcp} onPrinting={onPrinting} registerForm={registerForm} guardForm={guardForm} onPower={(id) => guardForm(() => { const dev = getDevice(projectRef.current,id); if (!dev) return; mutate(p => { const x=getDevice(p,id)!; x.poweredOn = x.poweredOn === false; }); closeTerminal(id); shells.current.clear(); rt.current = createRuntime(); toast(dev.poweredOn === false ? 'Équipement allumé.' : 'Équipement éteint.'); })} tab={inspTab} setTab={(t) => guardForm(() => setInspTab(t))} />}
          </aside>
        </main>
      </div>

      {modal?.type === 'form' && <ModalForm onChoice={(choice) => { const then=modal.then; if (choice === 'cancel') { setModal(null); return true; } if (choice === 'save' && !form.current?.apply()) return false; if (choice === 'discard') form.current?.discard(); form.current=null; setFormDirty(false); setModal(null); then(); return true; }} />}
      {modal?.type === 'unsaved' && <UnsavedDialog name={project.name} action={modal.action} onChoice={async (c: ConfirmChoice) => {
        const then = modal.then; setModal(null);
        if (c === 'cancel') return;
        if (c === 'save' && !(await save())) return;
        then();
      }} />}
      {modal?.type === 'projects' && <ProjectsDialog list={modal.list} currentId={project.id} onOpen={openStored} onClose={() => setModal(null)}
        onImport={() => fileInput.current?.click()}
        onDelete={async (id) => { await storeInfo.store.remove(id); if (id === project.id) setSavedOnce(false); setModal({ type: 'projects', list: await storeInfo.store.list() }); toast('Projet supprimé de ce navigateur.'); }} />}
      {modal?.type === 'pkt' && <PktDialog fileName={modal.name} onClose={() => setModal(null)} />}
      {modal?.type === 'learn' && <LearnDialog onExample={openExample} initialTab={modal.tab} onClose={() => setModal(null)} onStart={startExercise} currentExercise={exId} onResume={() => { setModal(null); setExerciseHidden(false); }} />}

      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast${t.kind ? ' ' + t.kind : ''}`}>{t.text}</div>)}</div>
    </div>
  );
}
