import React, { useEffect, useState } from 'react';
import type { Project, Device, HostNet, DhcpService } from '../model/types';
import { getModel } from '../devices/catalog';
import { findLink, otherEnd, getDevice } from '../model/project';
import { portState, osOf, l3Interfaces } from '../sim/topology';
import { isIp, isMask, isUsableHost, inSubnet } from '../sim/ip';
import { macDotted } from '../devices/factory';
import { DeviceIcon, Icon } from './icons';
import { Power, Clipboard, ChevronDown } from 'lucide-react';
import { maskToPrefix } from '../sim/ip';
import { Modal } from './Dialogs';
import { sendPrintJob } from '../sim/printing';
import { ping } from '../sim/engine';
import { createRuntime } from '../sim/runtime';
import { dhcpServiceProblem } from '../sim/dhcp';
import type { Sel } from './Canvas';

interface Props {
  project: Project;
  selection: Sel | null;
  mutate(f: (p: Project) => void): void;
  onOpenTerminal(id: string): void;
  onDuplicate(): void;
  onDelete(): void;
  onDhcp(id: string): void;
  onPower(id: string): void;
  onPrinting(id: string): void;
  registerForm(v: {apply: () => boolean; discard: () => void} | null): void;
  guardForm(f: () => void): void;
  tab: string; setTab(t: string): void;
}

export function Inspector(props: Props) {
  const { project, selection } = props;
  if (!selection) return <Overview project={project} />;
  if (selection.type === 'note') {
    const n = project.notes.find((x) => x.id === selection.id);
    if (!n) return <Overview project={project} />;
    return (
      <div className="panel stack">
        <h3>Note</h3>
        <div className="field"><label htmlFor="note-t">Texte</label>
          <textarea id="note-t" value={n.text} onChange={(e) => props.mutate((p) => { p.notes.find((x) => x.id === n.id)!.text = e.target.value; })} /></div>
        <button className="btn danger" onClick={props.onDelete}><Icon.trash size={16} />Supprimer la note</button>
      </div>
    );
  }
  if (selection.type === 'link') {
    const l = project.links.find((x) => x.id === selection.id);
    if (!l) return <Overview project={project} />;
    const ends = [l.a, l.b].map((e) => { const d = getDevice(project, e.device)!; const s = portState(project, d, e.port); return { d, port: d.ports.find((p) => p.name === e.port)!, s }; });
    return (
      <div className="panel stack">
        <h3>{/^(WiFi|Radio|DECT)/.test(l.a.port) || /^(WiFi|Radio|DECT)/.test(l.b.port) ? "Liaison sans fil" : "Câble Ethernet"}</h3>
        <div className="sub">{ /^(WiFi|Radio|DECT)/.test(l.a.port) || /^(WiFi|Radio|DECT)/.test(l.b.port) ? "Association manuelle, sans simulation de portée." : "Cuivre, croisement automatique (auto-MDIX)."}</div>
        <table className="ports-table"><thead><tr><th>Équipement</th><th>Port</th><th>État</th></tr></thead><tbody>
          {ends.map(({ d, port, s }) => <tr key={d.id + port.name}><td>{d.name}</td><td className="mono">{port.name}</td><td><span className={`dot ${s}`} />{stateLabel(s)}</td></tr>)}
        </tbody></table>
        {ends.some((e) => e.s !== 'up') && <div className="callout warn"><Icon.info size={16} /><span>Le lien est inactif : {ends.filter((e) => e.port.adminUp === false).map((e) => `${e.d.name} ${e.port.short} est désactivé (shutdown)`).join(', ') || 'un des ports est inactif'}.</span></div>}
        <button className="btn danger" onClick={props.onDelete}><Icon.trash size={16} />Retirer la liaison</button>
      </div>
    );
  }
  const d = getDevice(project, selection.id);
  if (!d) return <Overview project={project} />;
  return <DevicePanel {...props} d={d} />;
}

const stateLabel = (s: string) => (s === 'up' ? 'actif' : s === 'admin-down' ? 'désactivé' : 'inactif');

function DevicePanel(props: Props & { d: Device }) {
  const { d, project, tab, setTab } = props;
  const m = getModel(d.modelId);
  const os = osOf(d);
  const tabs: [string, string][] = [['apercu', 'Aperçu'], ...(os === 'host' ? [['ip', 'Réseau / IP'] as [string, string]] : []), ...(m.kind === 'server' ? [['services', 'Services'] as [string, string]] : []), ...(d.modelId === 'dect-phone' ? [['appel', 'Appel'] as [string, string]] : []), ...(m.kind === 'pc' ? [['print', 'Impression'] as [string, string], ['web', 'Web'] as [string, string]] : []), ...(m.kind === 'printer' ? [['queue', 'File d’attente'] as [string, string]] : []), ...(os === 'filter' ? [['filter', 'Filtrage'] as [string, string]] : []), ['ports', 'Ports']];
  const cur = tabs.some((t) => t[0] === tab) ? tab : 'apercu';
  return (
    <div>
      <div className="panel">
        <div className="dev-head">
          <div className={`tile k-${m.kind}${m.vendor === 'Allied Telesis' ? ' at' : ''}`}><DeviceIcon kind={m.kind} modelId={m.id} size={42} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input className="name-input" aria-label="Nom de l’équipement" value={d.name} onChange={(e) => props.mutate((p) => { const x = getDevice(p, d.id)!; x.name = e.target.value; if (os === 'host') x.config.hostname = e.target.value; })} />
            <div className="sub">{m.vendor} · {m.label}</div>
          </div>
          <button className="btn icon" title="Dupliquer (Ctrl+D)" aria-label="Dupliquer" onClick={props.onDuplicate}><Icon.copy size={16} /></button>
          <button className="btn icon danger" title="Supprimer (Suppr)" aria-label="Supprimer" onClick={props.onDelete}><Icon.trash size={16} /></button>
        </div>
        <div className="device-actions">
          {os !== 'bridge' && os !== 'filter' && <button className="btn primary terminal-action" disabled={d.poweredOn === false} onClick={() => props.onOpenTerminal(d.id)}><Icon.terminal size={16} />{os === 'host' ? 'Ouvrir l’invite de commandes' : 'Ouvrir le terminal (CLI)'}</button>}
          <button className="btn power-action" onClick={() => props.onPower(d.id)}><Power size={16}/>{d.poweredOn === false ? "Allumer" : "Éteindre"}</button>
        </div>
      </div>
      <div className="tabs compact-tabs" role="tablist">{tabs.slice(0,3).map(([id,label]) => <button key={id} role="tab" aria-selected={cur === id} className={cur === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}{tabs.length > 3 && <details className="more-tabs"><summary className={tabs.slice(3).some(t => t[0] === cur) ? 'on' : ''}>Plus <ChevronDown size={13}/></summary><div className="more-tabs-menu">{tabs.slice(3).map(([id,label]) => <button key={id} role="tab" aria-selected={cur === id} onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open=false; setTab(id); }}>{label}</button>)}</div></details>}</div>
      {cur === 'apercu' && (
        <div className="panel stack">
          <div className="status-card"><div><span>Alimentation</span><b className={`pill ${d.poweredOn === false ? 'orange' : 'green'}`}>{d.poweredOn === false ? 'Éteint' : 'Allumé'}</b></div>
            <div><span>Port {d.ports[0]?.short}</span><b className={`pill ${portState(project,d,d.ports[0].name) === 'up' ? 'green' : 'orange'}`}>{portState(project,d,d.ports[0].name) === 'up' ? 'Connecté' : 'Inactif'}</b></div>
            {d.config.host && <><div><span>Adresse IPv4</span><b>{d.config.host.ip ? `${d.config.host.ip}${isMask(d.config.host.mask) ? ` /${maskToPrefix(d.config.host.mask)}` : ''}` : 'Non configurée'}</b>{d.config.host.ip && <button className="btn ghost icon" aria-label="Copier l’adresse IPv4" onClick={() => { void navigator.clipboard?.writeText(d.config.host!.ip); }}><Clipboard size={15}/></button>}</div><div><span>Passerelle</span><b>{d.config.host.gateway || '—'}</b></div></>}
            <div><span>Adresse MAC</span><b className="mono">{d.ports[0]?.mac.match(/../g)?.join(':').toUpperCase()}</b></div></div>
          <details><summary>Fonctions et limites du matériel</summary><p>{m.summary}</p><h4>Pris en charge</h4><ul className="list">{m.supported.map((s) => <li key={s}>{s}</li>)}</ul><h4>Limites connues</h4><ul className="list muted">{m.limits.map((s) => <li key={s}>{s}</li>)}</ul></details>
        </div>
      )}
      {cur === 'ip' && <HostIpForm key={d.id} {...props} />}
      {cur === 'print' && <PrintFromPC key={d.id} {...props} />}
      {cur === 'queue' && <PrinterQueue {...props} />}
      {cur === 'filter' && <FirewallForm key={d.id} {...props} />}
      {cur === 'web' && <WebLink key={d.id} />}
      {cur === 'appel' && <PhoneCall project={project} d={d} />}
      {cur === 'services' && <ServerServices key={d.id} {...props} />}
      {cur === 'ports' && (
        <div className="panel">
          <table className="ports-table"><thead><tr><th>Port</th><th>État</th><th>Relié à</th><th>{m.kind === 'switch' ? 'VLAN' : 'IP'}</th></tr></thead><tbody>
            {d.ports.map((pt) => {
              const s = portState(project, d, pt.name);
              const l = findLink(project, d.id, pt.name);
              const o = l && otherEnd(l, d.id, pt.name);
              const od = o && getDevice(project, o.device);
              const info = m.kind === 'switch' ? (pt.mode === 'trunk' ? 'trunk' : String(pt.accessVlan ?? 1)) : os === 'host' ? (d.config.host!.ip || '—') : (pt.ip ?? '—');
              return <tr key={pt.name}><td className="mono">{pt.short}</td><td><span className={`dot ${s}`} />{stateLabel(s)}</td><td>{od ? `${od.name} ${od.ports.find((x) => x.name === o!.port)?.short}` : '—'}</td><td className="mono">{info}</td></tr>;
            })}
          </tbody></table>
          <p className="sub">MAC du premier port : <code>{macDotted(d.ports[0].mac)}</code></p>
        </div>
      )}
    </div>
  );
}

function HostIpForm(props: Props & { d: Device }) {
  const { d } = props;
  const h = d.config.host!;
  const [f, setF] = useState<HostNet>(h);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setF(h); }, [h.ip, h.mask, h.gateway, h.dns, h.mode]); // eslint-disable-line
  const errs: Record<string, string> = {};
  if (f.mode === 'static') {
    if (f.ip && !isIp(f.ip)) errs.ip = 'Adresse IPv4 invalide (ex. 192.168.1.10).';
    if (f.mask && !isMask(f.mask)) errs.mask = 'Masque invalide (ex. 255.255.255.0).';
    if (f.ip && !f.mask) errs.mask = 'Indiquez un masque de sous-réseau.';
    if (!errs.ip && !errs.mask && f.ip && f.mask && !isUsableHost(f.ip, f.mask)) errs.ip = 'Cette adresse est l’adresse du réseau ou de diffusion : elle ne peut pas être donnée à une machine.';
    if (f.gateway && !isIp(f.gateway)) errs.gateway = 'Passerelle invalide.';
    else if (f.gateway && f.ip && f.mask && isMask(f.mask) && !inSubnet(f.gateway, f.ip, f.mask)) errs.gateway = 'La passerelle doit être dans le même réseau que le PC.';
    if (f.dns && !isIp(f.dns)) errs.dns = 'DNS invalide.';
  }
  const dirty = JSON.stringify(f) !== JSON.stringify(h);
  const duplicates = f.ip && isIp(f.ip)
    ? props.project.devices.filter(x => x.id !== d.id && l3Interfaces(props.project, x).some(i => i.ip === f.ip))
    : [];
  const apply = () => { if (Object.keys(errs).length > 0) { setMsg('Corrigez les champs indiqués avant d’appliquer.'); return false; } props.mutate((p) => { const x = getDevice(p, d.id)!; x.config.host = { ...f, dhcpServer: undefined }; }); setMsg('Configuration appliquée.'); return true; };
  useEffect(() => { props.registerForm(dirty ? {apply, discard: () => setF(h)} : null); }, [dirty, f, h, props.registerForm]);
  useEffect(() => () => props.registerForm(null), [props.registerForm]);
  const field = (k: keyof HostNet, label: string, ph: string) => (
    <div className="field"><label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} value={(f[k] as string) ?? ''} placeholder={ph} disabled={f.mode === 'dhcp'} className={errs[k] ? 'err' : ''} spellCheck={false}
        onChange={(e) => setF({ ...f, [k]: e.target.value.trim() })}
        onBlur={() => { if (k === 'ip' && isIp(f.ip) && !f.mask) setF({ ...f, mask: '255.255.255.0' }); }} />
      {errs[k] && <span className="msg">{errs[k]}</span>}
    </div>
  );
  return (
    <div className="panel">
      <div className="segmented" style={{ marginBottom: 14 }} role="radiogroup" aria-label="Mode d’adressage">
        <button className={f.mode === 'static' ? 'on' : ''} onClick={() => { setF({ ...f, mode: 'static' }); }}>Statique</button>
        <button className={f.mode === 'dhcp' ? 'on' : ''} onClick={() => props.guardForm(() => { props.onDhcp(d.id); setMsg(null); })}>DHCP</button>
      </div>
      {field('ip', 'Adresse IPv4', '192.168.1.10')}
      {duplicates.length > 0 && <div className="callout warn" role="status"><Icon.info size={16}/><span>Adresse aussi utilisée par {duplicates.map(x => x.name).join(', ')}. Vérifiez si ces appareils partagent le même réseau.</span></div>}
      {field('mask', 'Masque de sous-réseau', '255.255.255.0')}
      {field('gateway', 'Passerelle par défaut', '192.168.1.1 (facultatif)')}
      {field('dns', 'Serveur DNS', 'facultatif')}
      {f.mode === 'static' ? (
        <div className="row">
          <button className="btn primary" disabled={!dirty || Object.keys(errs).length > 0} onClick={apply}>Appliquer</button>
          {dirty && <button className="btn ghost" onClick={() => setF(h)}>Annuler</button>}
          {msg && !dirty && <span className="sub">{msg}</span>}
        </div>
      ) : (
        <div className="stack">
          <button className="btn" onClick={() => props.onDhcp(d.id)}><Icon.reset size={16} />Renouveler l’adresse (DHCP)</button>
          <div className="sub">{h.dhcpServer ? `Bail obtenu auprès de ${h.dhcpServer}.` : h.ip.startsWith('169.254') ? 'Aucun serveur DHCP n’a répondu : adresse APIPA.' : 'Pas encore d’adresse.'}</div>
        </div>
      )}
    </div>
  );
}

function ServerServices(props: Props & { d: Device }) {
  const { d } = props;
  const s = d.config.dhcpService!;
  const poolProblem = dhcpServiceProblem(s, d.config.host!.ip, d.config.host!.mask);
  const set = (patch: Partial<DhcpService>) => props.mutate((p) => { const x = getDevice(p, d.id)!; x.config.dhcpService = { ...x.config.dhcpService!, ...patch }; });
  const bad = (v: string, f: (x: string) => boolean) => (v && !f(v) ? 'err' : '');
  return (
    <div className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Service DHCP</b>
        <div className="segmented"><button className={!s.enabled ? 'on' : ''} onClick={() => set({ enabled: false })}>Arrêté</button><button className={s.enabled ? 'on' : ''} onClick={() => set({ enabled: true })}>Actif</button></div>
      </div>
      {!d.config.host!.ip && <div className="callout warn"><Icon.info size={16} /><span>Le serveur doit avoir une adresse IP statique pour répondre aux requêtes DHCP.</span></div>}
      <div className="field"><label>Première adresse du pool</label><input className={bad(s.poolStart, isIp)} value={s.poolStart} onChange={(e) => set({ poolStart: e.target.value.trim() })} /></div>
      <div className="field"><label>Masque</label><input className={bad(s.mask, isMask)} value={s.mask} onChange={(e) => set({ mask: e.target.value.trim() })} /></div>
      <div className="field"><label>Nombre maximal de clients</label><input type="number" min={1} max={1000} value={s.maxUsers} onChange={(e) => set({ maxUsers: Math.max(1, Math.min(1000, Math.floor(+e.target.value || 1))) })} /></div>
      <div className="field"><label>Passerelle distribuée</label><input className={bad(s.gateway, isIp)} value={s.gateway} onChange={(e) => set({ gateway: e.target.value.trim() })} /></div>
      <div className="field"><label>DNS distribué</label><input className={bad(s.dns, isIp)} value={s.dns} onChange={(e) => set({ dns: e.target.value.trim() })} /></div>
      {s.enabled && poolProblem && <div className="callout warn" role="status"><Icon.info size={16} /><span>{poolProblem}</span></div>}
      <div><b style={{ fontSize: 13 }}>Baux attribués</b>
        {(d.config.leases ?? []).length === 0 ? <div className="sub">Aucun.</div> : <table className="ports-table"><tbody>{d.config.leases!.map((l) => <tr key={l.mac}><td className="mono">{l.ip}</td><td>{l.clientName}</td></tr>)}</tbody></table>}
      </div>
      <div className="callout info"><Icon.info size={16} /><span>Services HTTP, DNS, FTP et messagerie : <b>pas encore implémentés</b>.</span></div>
    </div>
  );
}

function PhoneCall({ project, d }: { project: Project; d: Device }) {
  const phones = project.devices.filter(x => x.modelId === 'dect-phone' && x.id !== d.id);
  const [target, setTarget] = useState('');
  const [result, setResult] = useState('');
  const call = () => {
    const dest = phones.find(x => x.id === target);
    if (!dest || !dest.config.host?.ip) { setResult('Choisissez un autre combiné avec une adresse IP.'); return; }
    if (project.devices.flatMap(x => l3Interfaces(project, x)).filter(i => i.ip === dest.config.host!.ip).length !== 1) { setResult('Adresse IP de destination en double : corrigez la configuration avant le test.'); return; }
    const r = ping(project, d.id, dest.config.host.ip, createRuntime());
    if (!r.success) { setResult(`Appel impossible : ${r.reason || 'réseau injoignable.'}`); return; }
    setResult(`Test réussi : ${dest.name} sonne. La sonnerie est jouée sur cet appareil.`);
    try {
      const audio = new AudioContext();
      const t = audio.currentTime;
      [0, 0.75].forEach(offset => { const o = audio.createOscillator(), gain = audio.createGain(); o.type = 'sine'; o.frequency.value = 440; gain.gain.setValueAtTime(0.001, t + offset); gain.gain.exponentialRampToValueAtTime(0.12, t + offset + .03); gain.gain.exponentialRampToValueAtTime(0.001, t + offset + .48); o.connect(gain).connect(audio.destination); o.start(t + offset); o.stop(t + offset + .5); });
      setTimeout(() => audio.close(), 1800);
    } catch { setResult(`Réseau joignable, mais la sonnerie ne peut pas être jouée dans ce navigateur.`); }
  };
  return <div className="panel stack"><div className="phone-screen"><b>{d.name}</b><span>{d.config.host?.ip || 'Adresse IP non configurée'}</span><span>{target ? phones.find(x => x.id === target)?.name : 'Choisissez un correspondant'}</span></div><p>Testez la liaison entre deux combinés configurés en IP et associés à une base DECT.</p><div className="field"><label htmlFor="call-target">Appeler</label><select id="call-target" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choisir un téléphone</option>{phones.map(x => <option key={x.id} value={x.id}>{x.name} {x.config.host?.ip || '(sans IP)'}</option>)}</select></div><button className="btn primary" onClick={call}>Tester l’appel</button>{result && <div role="status" className="callout info">{result}</div>}<p className="sub">Test pédagogique fondé sur un ping. Sonnerie locale uniquement : pas de voix ni de signalisation téléphonique réelle.</p></div>;
}

function Overview({ project }: { project: Project }) {
  return <div className="panel overview"><h3>Votre espace</h3><p className="sub">{project.devices.length} équipement(s) · {project.links.length} liaison(s)</p><p>Sélectionnez un équipement pour voir ses réglages.</p><details><summary>Besoin d’aide ?</summary><ol className="list"><li>Ajoutez un équipement à gauche.</li><li>Choisissez « Relier » puis les ports des deux équipements.</li><li>Sélectionnez un appareil pour le configurer. Pour en sélectionner plusieurs, tracez un cadre sur le fond avec le clic gauche, ou utilisez Maj + clic.</li><li>Utilisez Simulation pour suivre un ping ou DHCP.</li></ol><p className="sub">Points : vert = actif, rouge = désactivé, gris = inactif. Les liaisons radio sont en pointillés.</p><p className="sub">Raccourcis : V sélection, C relier, N note, F ajuster, Ctrl+S enregistrer.</p></details></div>;
}


function FirewallForm({d, mutate, registerForm}: Props & {d: Device}) {
  const [rows, setRows] = useState(() => d.ports.map(pt => ({ name: pt.name, ip: pt.ip || '', mask: pt.mask || '255.255.255.0', up: pt.adminUp, block: d.config.acls?.find(a => a.id === pt.aclIn)?.entries.find(e => e.action === 'deny')?.src || '' })));
  const [message, setMessage] = useState('');
  function change(index: number, patch: Partial<typeof rows[number]>) { setRows(r => r.map((v,i) => i === index ? {...v,...patch} : v)); setMessage(''); }
  const original = d.ports.map(pt => ({ name: pt.name, ip: pt.ip || '', mask: pt.mask || '255.255.255.0', up: pt.adminUp, block: d.config.acls?.find(a => a.id === pt.aclIn)?.entries.find(e => e.action === 'deny')?.src || '' }));
  const formDirty = JSON.stringify(rows) !== JSON.stringify(original);
  useEffect(() => { registerForm(formDirty ? {apply, discard: () => setRows(original)} : null); }, [rows, d, registerForm]);
  useEffect(() => () => registerForm(null), [registerForm]);
  function apply(): boolean {
    for (const row of rows) {
      if ((row.ip && (!isIp(row.ip) || !isMask(row.mask) || !isUsableHost(row.ip,row.mask))) || (row.block && !isIp(row.block))) { setMessage('Vérifiez les adresses IPv4 et les masques.'); return false; }
    }
    mutate(p => {
      const fw = getDevice(p,d.id)!; fw.config.acls = [];
      rows.forEach((row,i) => {
        const pt = fw.ports[i]; Object.assign(pt, {ip:row.ip,mask:row.mask,adminUp:row.up,aclIn: row.block ? `FILTRE-${i+1}` : undefined});
        if (row.block) fw.config.acls!.push({id:`FILTRE-${i+1}`,type:'extended',entries:[{action:'deny',protocol:'ip',src:row.block,srcWc:'0.0.0.0',dst:'0.0.0.0',dstWc:'255.255.255.255'},{action:'permit',protocol:'ip',src:'0.0.0.0',srcWc:'255.255.255.255',dst:'0.0.0.0',dstWc:'255.255.255.255'}]});
      });
    }); setMessage('Configuration appliquée.'); return true;
  }
  return <div className="panel stack"><p className="sub">Maquette pédagogique, pas une émulation ASA. Le blocage s’applique à la source en entrée ; tout le reste est autorisé. Pas de filtrage avec état.</p>{rows.map((r,i)=><div key={r.name} className="stack" style={{borderTop:'1px solid var(--border)',paddingTop:12}}><b>{r.name}</b><div className="field"><label htmlFor={`fw-ip-${i}`}>Adresse IPv4</label><input id={`fw-ip-${i}`} value={r.ip} onChange={e=>change(i,{ip:e.target.value.trim()})} placeholder="192.168.1.1" /></div><div className="field"><label htmlFor={`fw-mask-${i}`}>Masque</label><input id={`fw-mask-${i}`} value={r.mask} onChange={e=>change(i,{mask:e.target.value.trim()})} /></div><div className="field"><label htmlFor={`fw-block-${i}`}>Bloquer cette source en entrée (facultatif)</label><input id={`fw-block-${i}`} value={r.block} onChange={e=>change(i,{block:e.target.value.trim()})} placeholder="ex. 192.168.1.11" /></div><label><input type="checkbox" checked={r.up} onChange={e=>change(i,{up:e.target.checked})} /> Interface activée</label></div>)}<button className="btn primary" onClick={apply}>Appliquer</button>{message && <p role="status" className="sub">{message}</p>}</div>;
}

function PrintFromPC({d, project, mutate, onPrinting}: Props & {d:Device}) {
 const printers=project.devices.filter(x=>x.modelId==='printer'); const [target,setTarget]=useState('');const [text,setText]=useState('Page de test');const [msg,setMsg]=useState('');
 function print() { try { sendPrintJob(structuredClone(project),d.id,target,text); mutate(p=>sendPrintJob(p,d.id,target,text)); onPrinting(target); setMsg('Impression simulée en cours : page envoyée à la file.'); } catch(e) { setMsg((e as Error).message); } }
 return <div className="panel stack"><div className="field"><label htmlFor="print-target">Imprimante</label><select id="print-target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choisir une imprimante</option>{printers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.config.host?.ip || 'sans IP'}</option>)}</select></div><div className="field"><label htmlFor="print-text">Texte de la page test</label><textarea id="print-text" maxLength={500} value={text} onChange={e=>setText(e.target.value)} /></div><button className="btn primary" onClick={print}>Envoyer la page</button>{msg && <p role="status">{msg}</p>}<p className="sub">Simulation : le réseau doit être joignable. Aucune imprimante réelle n’est utilisée.</p></div>;
}
function PrinterQueue({d, mutate}: Props & {d:Device}) { const jobs=d.config.printJobs || []; return <div className="panel stack"><h3>File d’attente simulée</h3>{jobs.length===0 ? <p className="sub">Aucune page reçue.</p> : jobs.map((j,i)=><div className="callout info" key={i}><span><b>{j.from}</b><br/>{j.text}</span></div>)}{jobs.length>0 && <button className="btn" onClick={()=>mutate(p=>{getDevice(p,d.id)!.config.printJobs=[]})}>Vider la file</button>}<p className="sub">Cette file ne lance pas d’impression physique.</p></div>; }

function WebLink() {
 const [url,setUrl] = useState('https://example.com'); const [error,setError] = useState('');const [openUrl,setOpenUrl] = useState('');
 function open() { try { const u = new URL(url.trim()); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error(); setOpenUrl(u.href); setError(''); } catch { setError('Entrez une adresse complète en http:// ou https://.'); } }
 return <div className="panel stack"><p>Ouvrir un site dans une fenêtre intégrée.</p><div className="field"><label htmlFor="web-link">Adresse web</label><input id="web-link" type="url" value={url} onChange={e=>setUrl(e.target.value)} /></div><button className="btn primary" onClick={open}>Afficher le site</button>{error && <p role="status">{error}</p>}<p className="sub">Utilise la connexion réelle de votre appareil, sans passer par le réseau simulé. Certains sites interdisent l’intégration.</p>{openUrl && <Modal wide title="Navigateur web" onClose={()=>setOpenUrl('')}><div className="web-window"><div className="web-address">{openUrl}</div><p>Certains sites, comme altern.pro, interdisent leur affichage ici pour des raisons de sécurité. Ce blocage ne peut pas être contourné. <a href={openUrl} target="_blank" rel="noopener noreferrer">Ouvrir le site dans un nouvel onglet ↗</a></p><iframe title="Site web externe" src={openUrl} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerPolicy="no-referrer" /></div></Modal>}</div>;
}
