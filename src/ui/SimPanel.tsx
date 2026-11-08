// Mode Simulation : rejoue pas à pas les événements calculés par le moteur (ping, DHCP).
import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../model/types';
import type { SimEvent } from '../sim/engine';
import { ping } from '../sim/engine';
import { dhcpRenew } from '../sim/dhcp';
import type { Runtime } from '../sim/runtime';
import { l3Interfaces, isHost, osOf } from '../sim/topology';
import { getDevice } from '../model/project';
import { isIp } from '../sim/ip';
import type { Anim } from './Canvas';
import { Icon } from './icons';

interface Props {
  project: Project;
  rt: Runtime;
  setAnim(a: Anim | null): void;
  commit(p: Project): void;
  preferredSource?: string | null;
}
interface Run { title: string; events: SimEvent[]; ok: boolean; summary: string }

const SPEEDS = [0.5, 1, 2, 4];
const KIND_PILL: Record<string, string> = { ARP: 'orange', ICMP: 'blue', DHCP: 'purple' };

export function SimPanel(props: Props) {
  const { project } = props;
  const devs = project.devices;
  const ipTargets = devs.flatMap((d) => l3Interfaces(project, d).map((i) => ({ label: `${d.name} — ${i.ip} (${i.name})`, ip: i.ip })));
  const hosts = devs.filter(isHost);
  const [kind, setKind] = useState<'ping' | 'dhcp'>('ping');
  const [src, setSrc] = useState<string>(props.preferredSource && getDevice(project, props.preferredSource) ? props.preferredSource : devs[0]?.id ?? '');
  const [dst, setDst] = useState<string>('');
  const [run, setRun] = useState<Run | null>(null);
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const tRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sources = kind === 'dhcp' ? hosts : devs.filter(d => osOf(d) !== 'bridge');
  useEffect(() => { if (!sources.some(d => d.id === src)) setSrc(sources[0]?.id ?? ''); }, [project, src, kind]);
  useEffect(() => { if (props.preferredSource && sources.some(d => d.id === props.preferredSource)) setSrc(props.preferredSource); }, [props.preferredSource]);

  // Animation : avance le paquet le long du câble, puis passe à l'événement suivant.
  useEffect(() => {
    if (!run || idx < 0 || idx >= run.events.length) { props.setAnim(null); return; }
    const ev = run.events[idx];
    let raf = 0; let last = performance.now();
    tRef.current = playing ? 0 : 1;
    const dur = (ev.hop ? 750 : 520) / speed;
    const draw = () => props.setAnim({ hop: ev.hop, t: tRef.current, kind: ev.kind, at: ev.at, status: ev.status });
    draw();
    if (!playing) return;
    const loop = (now: number) => {
      tRef.current += (now - last) / dur; last = now;
      if (tRef.current >= 1) {
        tRef.current = 1; draw();
        if (idx + 1 < run.events.length) setIdx(idx + 1); else setPlaying(false);
        return;
      }
      draw(); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [run, idx, playing, speed]);
  useEffect(() => () => props.setAnim(null), []);
  useEffect(() => { listRef.current?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); }, [idx]);

  function start() {
    setErr(null);
    const s = getDevice(project, src);
    if (!s) { setErr('Choisissez un équipement source.'); return; }
    let eventCount = 0;
    if (kind === 'ping') {
      const target = dst.trim();
      if (!isIp(target)) { setErr('Indiquez une adresse IP de destination valide (ex. 192.168.1.2).'); return; }
      const r = ping(project, s.id, target, props.rt);
      eventCount = r.events.length;
      const summary = r.success ? `Le ping de ${s.name} vers ${target} réussit.` : `Échec du ping : ${r.reason ?? 'aucune réponse.'}`;
      setRun({ title: `Ping ${s.name} → ${target}`, events: r.events, ok: r.success, summary });
    } else {
      if (!isHost(s)) { setErr('DHCP : choisissez un PC ou un serveur.'); return; }
      const draft = structuredClone(project);
      const r = dhcpRenew(draft, s.id);
      eventCount = r.events.length;
      props.commit(draft);
      setRun({ title: `DHCP pour ${s.name}`, events: r.events, ok: r.ok, summary: r.message });
    }
    // A disconnected or switched-off host may return no events. Show its result immediately.
    setIdx(eventCount ? 0 : -1); setPlaying(eventCount > 0);
  }
  function reset() { setRun(null); setIdx(-1); setPlaying(false); props.setAnim(null); }

  const atEnd = run ? idx >= run.events.length - 1 : true;
  const name = (id: string) => getDevice(project, id)?.name ?? '?';

  return (
    <div className="panel">
      <div className="section">
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Mode Simulation</h3>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 12.5 }}>Suivez un ping ou une requête DHCP. Le DHCP modifie la configuration simulée du client.</p>
      </div>
      <div className="section stack">
        <div className="segmented" role="tablist" aria-label="Type de test">
          <button className={kind === 'ping' ? 'on' : ''} onClick={() => { setKind('ping'); reset(); }}>Ping</button>
          <button className={kind === 'dhcp' ? 'on' : ''} onClick={() => { setKind('dhcp'); reset(); }}>Requête DHCP</button>
        </div>
        <div className="field">
          <label htmlFor="sim-src">Source</label>
          <select id="sim-src" value={src} onChange={(e) => setSrc(e.target.value)}>
            {sources.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {kind === 'ping' && (
          <div className="field">
            <label htmlFor="sim-dst">Destination (adresse IP)</label>
            <input id="sim-dst" list="sim-ips" value={dst} placeholder="ex. 192.168.1.2" onChange={(e) => setDst(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') start(); }} />
            <datalist id="sim-ips">{ipTargets.map((t) => <option key={t.label} value={t.ip}>{t.label}</option>)}</datalist>
          </div>
        )}
        {err && <div className="callout err" role="alert"><Icon.info size={16} />{err}</div>}
        <button className="btn primary" onClick={start} disabled={!sources.length}><Icon.play size={15} />Voir le trajet</button>
      </div>
      {run && (
        <div className="section stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ flex: 1, fontSize: 13.5 }}>{run.title}</b>
            <span className="term-meta" style={{ margin: 0, color: 'var(--text-2)' }}>{Math.max(0, idx + 1)}/{run.events.length}</span>
          </div>
          <div className="sim-controls">
            <button className="btn icon" aria-label="Étape précédente" title="Étape précédente" disabled={idx <= 0} onClick={() => { setPlaying(false); setIdx(idx - 1); }}><Icon.prev size={15} /></button>
            {playing
              ? <button className="btn icon" aria-label="Pause" title="Pause" onClick={() => setPlaying(false)}><Icon.pause size={15} /></button>
              : <button className="btn icon" aria-label="Lecture" title="Lecture" disabled={!run.events.length} onClick={() => { if (atEnd) setIdx(0); setPlaying(true); }}><Icon.play size={15} /></button>}
            <button className="btn icon" aria-label="Étape suivante" title="Étape suivante" disabled={atEnd} onClick={() => { setPlaying(false); setIdx(idx + 1); }}><Icon.next size={15} /></button>
            <button className="btn icon" aria-label="Recommencer" title="Recommencer" disabled={!run.events.length} onClick={() => { setIdx(0); setPlaying(false); }}><Icon.reset size={15} /></button>
            <span className="spacer" />
            <select aria-label="Vitesse" value={speed} onChange={(e) => setSpeed(+e.target.value)} style={{ height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', padding: '0 6px' }}>
              {SPEEDS.map((v) => <option key={v} value={v}>×{v}</option>)}
            </select>
          </div>
          {atEnd && !playing && (
            <div className={`callout ${run.ok ? 'ok' : 'err'}`} role="status">
              {run.ok ? <Icon.check size={16} /> : <Icon.x size={16} />}<span>{run.summary}</span>
            </div>
          )}
          <div className="sim-events" ref={listRef}>
            {run.events.map((ev, i) => (
              <div key={i} className={`sim-ev ${ev.status}${i === idx ? ' cur' : ''}${i > idx ? ' future' : ''}`} onClick={() => { setPlaying(false); setIdx(i); }}>
                <span className="n">{i + 1}</span>
                <span><span className={`pill ${KIND_PILL[ev.kind]}`}>{ev.kind}</span></span>
                <span>{ev.hop ? <b>{name(ev.hop.from)} → {name(ev.hop.to)} · </b> : <b>{name(ev.at)} · </b>}{ev.text}</span>
              </div>
            ))}
          </div>
          <button className="btn" onClick={reset}>Effacer la simulation</button>
        </div>
      )}
      {!run && (
        <details className="section legend"><summary>Comprendre les étapes</summary>
          <div><span className="pill orange">ARP</span> recherche d’adresse MAC</div>
          <div><span className="pill blue">ICMP</span> ping (echo request / reply)</div>
          <div><span className="pill purple">DHCP</span> attribution d’adresse</div>
          <div style={{ marginTop: 6 }}>Les cartes de couleur se déplacent sur les câbles du schéma. Un équipement qui clignote en rouge indique l’endroit où le paquet est perdu.</div>
        </details>
      )}
    </div>
  );
}
