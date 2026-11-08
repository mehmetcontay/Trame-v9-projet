import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import type { Project, LinkEnd, Device } from '../model/types';
import { getModel } from '../devices/catalog';
import { findLink, getDevice, otherEnd } from '../model/project';
import { portState, PortState } from '../sim/topology';
import type { Hop } from '../sim/l2';
import { DeviceIcon, Icon } from './icons';

export type Sel = { type: 'device' | 'link' | 'note'; id: string };
export interface Anim { hop?: Hop; t: number; kind: string; at?: string; status: string }
export interface CanvasApi { fit(): void; center(): { x: number; y: number } }
interface Props {
  project: Project;
  selection: Sel[];
  onSelect(s: Sel | null, additive?: boolean): void;
  onSelectMany(items: Sel[], additive: boolean): void;
  onMove(sel: Sel, x: number, y: number): void;
  tool: 'select' | 'cable';
  editable: boolean;
  setTool(t: 'select' | 'cable'): void;
  onCreateLink(a: LinkEnd, b: LinkEnd): void;
  onDropModel(modelId: string, x: number, y: number): void;
  onOpen(id: string): void;
  onAddNote(): void;
  printingId: string | null;
  onContext(action: 'cable' | 'terminal' | 'ip' | 'delete', id: string): void;
  anim: Anim | null;
  children?: React.ReactNode;
  /** espace réservé à droite (carte d'exercice) lors de l'ajustement */
  padRight?: number;
}
const KIND_CLASS = (d: Device) => { const m = getModel(d.modelId); return `k-${m.kind}${m.vendor === 'Allied Telesis' ? ' at' : ''}`; };
const TILE = 68;
const STATE_COLOR: Record<PortState, string> = { up: 'var(--green)', down: 'var(--text-2)', 'admin-down': 'var(--red)' };
const KIND_COLOR: Record<string, string> = { ARP: '#E0A93B', ICMP: 'var(--accent)', DHCP: 'var(--purple)' };

export const Canvas = forwardRef<CanvasApi, Props>(function Canvas(props, ref) {
  const { project, selection, onSelect, tool, anim } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [drag, setDrag] = useState<{ sel: Sel; ox: number; oy: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [picker, setPicker] = useState<{ dev: string; x: number; y: number } | null>(null);
  const [pending, setPending] = useState<LinkEnd | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const [marquee, setMarquee] = useState<{sx:number;sy:number;x:number;y:number; additive:boolean} | null>(null);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);

  const fit = useCallback(() => {
    const el = wrap.current; if (!el) return;
    const pts = [...project.devices.map((d) => [d.x, d.y]), ...project.notes.map((n) => [n.x + 60, n.y + 10])];
    if (!pts.length) { setView({ x: 40, y: 40, k: 1 }); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 90, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 90;
    const pr = el.clientWidth > 640 ? (props.padRight ?? 0) : 0;
    const W = el.clientWidth - pr, H = el.clientHeight;
    const k = Math.max(0.35, Math.min(1.15, Math.min(W / (maxX - minX), (H - 60) / (maxY - minY))));
    setView({ k, x: (W - (maxX - minX) * k) / 2 - minX * k, y: 30 + (H - 60 - (maxY - minY) * k) / 2 - minY * k });
  }, [project, props.padRight]);
  useImperativeHandle(ref, () => ({
    fit,
    center: () => { const el = wrap.current!; return { x: (el.clientWidth / 2 - view.x) / view.k, y: (el.clientHeight / 2 - view.y) / view.k }; },
  }), [fit, view]);
  const firstFit = useRef(project.id);
  useEffect(() => { if (firstFit.current !== project.id) { firstFit.current = project.id; setTimeout(fit, 0); } }, [project.id, fit]);
  useEffect(() => { setTimeout(fit, 0); }, []); // eslint-disable-line
  useEffect(() => { if (tool === 'select') { setPending(null); setPicker(null); } }, [tool]);

  // Zoom molette (centré sur le curseur)
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.exercise-card, .port-picker, .exercise-reopen')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.3, Math.min(2.5, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const zoomBy = (f: number) => {
    const el = wrap.current!; const mx = el.clientWidth / 2, my = el.clientHeight / 2;
    setView((v) => { const k = Math.max(0.3, Math.min(2.5, v.k * f)); return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }; });
  };

  const isSelected = (s: Sel) => selection.some((x) => x.type === s.type && x.id === s.id);
  const posOf = (sel: Sel, x: number, y: number) => {
    if (!drag || !props.editable) return { x, y };
    const same = drag.sel.type === sel.type && drag.sel.id === sel.id;
    if (same || (isSelected(drag.sel) && isSelected(sel))) return { x: x + drag.x - drag.ox, y: y + drag.y - drag.oy };
    return { x, y };
  };

  const startDrag = (e: React.PointerEvent, sel: Sel, x: number, y: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ sel, ox: x, oy: y, sx: e.clientX, sy: e.clientY, x, y, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pending) setMouse(toWorld(e.clientX, e.clientY));
    if (marquee) { const w = toWorld(e.clientX,e.clientY); setMarquee({...marquee,x:w.x,y:w.y}); return; }
    if (drag) {
      const dx = (e.clientX - drag.sx) / view.k, dy = (e.clientY - drag.sy) / view.k;
      if (Math.abs(dx) + Math.abs(dy) > 3 || drag.moved) setDrag({ ...drag, x: Math.round(drag.ox + dx), y: Math.round(drag.oy + dy), moved: true });
    } else if (pan) {
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3 || pan.moved) { setPan({ ...pan, moved: true }); setView((v) => ({ ...v, x: pan.vx + dx, y: pan.vy + dy })); }
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (marquee) {
      const w = toWorld(e.clientX,e.clientY);
      const left = Math.min(marquee.sx,w.x), right = Math.max(marquee.sx,w.x), top = Math.min(marquee.sy,w.y), bottom = Math.max(marquee.sy,w.y);
      if ((right-left)*view.k > 4 || (bottom-top)*view.k > 4) {
        const hits: Sel[] = [
          ...project.devices.filter(d => d.x + TILE/2 >= left && d.x - TILE/2 <= right && d.y + TILE/2 >= top && d.y - TILE/2 <= bottom).map(d => ({type:'device' as const,id:d.id})),
          ...project.notes.filter(n => n.x + 230 >= left && n.x <= right && n.y + 60 >= top && n.y <= bottom).map(n => ({type:'note' as const,id:n.id}))
        ];
        props.onSelectMany(hits,marquee.additive);
      } else if (!marquee.additive) { onSelect(null); setPicker(null); }
      setMarquee(null);
    } else if (drag) {
      if (drag.moved && props.editable) { props.onMove(drag.sel, drag.x, drag.y); if (!isSelected(drag.sel)) onSelect(drag.sel); }
      else if (drag.moved) onSelect(drag.sel);
      else if (drag.sel.type === 'device' && tool === 'cable') openPicker(drag.sel.id, e);
      else onSelect(drag.sel, multiMode || e.shiftKey || e.ctrlKey || e.metaKey);
      setDrag(null);
    } else if (pan) {
      if (e.pointerType === 'touch' && !pan.moved) { onSelect(null); setPicker(null); }
      setPan(null);
    }
  };
  const openPicker = (devId: string, e: React.PointerEvent) => {
    if (pending && pending.device === devId) return;
    const r = wrap.current!.getBoundingClientRect();
    setPicker({ dev: devId, x: Math.min(e.clientX - r.left + 10, r.width - 240), y: Math.min(e.clientY - r.top + 10, r.height - 310) });
  };
  const choosePort = (port: string) => {
    if (!picker) return;
    const end = { device: picker.dev, port };
    setPicker(null);
    if (!pending) { setPending(end); return; }
    props.onCreateLink(pending, end);
    setPending(null); setMouse(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPicker(null); setPending(null); if (tool === 'cable') props.setTool('select'); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const showPorts = view.k >= 0.6;
  const devPos = (id: string) => { const d = getDevice(project, id); return d ? posOf({ type: 'device', id }, d.x, d.y) : { x: 0, y: 0 }; };

  // Position du paquet animé
  let packet: { x: number; y: number } | null = null;
  if (anim?.hop) {
    const a = devPos(anim.hop.from), b = devPos(anim.hop.to);
    const t = Math.min(1, Math.max(0, anim.t));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    packet = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
  }
  const pickerDev = picker && getDevice(project, picker.dev);

  return (
    <div ref={wrap} className={`canvas-wrap ${tool === 'cable' ? 'cable' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-trame-model')) e.preventDefault(); }}
      onDrop={(e) => { const m = e.dataTransfer.getData('text/x-trame-model'); if (m) { e.preventDefault(); const w = toWorld(e.clientX, e.clientY); props.onDropModel(m, Math.round(w.x), Math.round(w.y)); } }}>
      <svg className="topo" onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => {
        if (e.button === 2 || (e.pointerType === 'touch' && e.button === 0)) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setPan({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
        } else if (e.button === 0 && tool === 'select') { const w = toWorld(e.clientX,e.clientY); e.currentTarget.setPointerCapture(e.pointerId); setMarquee({sx:w.x,sy:w.y,x:w.x,y:w.y,additive:e.shiftKey || e.ctrlKey || e.metaKey}); } else if (e.button === 0) { onSelect(null); setPicker(null); }
      }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { setPan(null); setDrag(null); setMarquee(null); }} role="application" aria-label="Espace de topologie">
        <defs>
          <pattern id="grid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {marquee && <rect x={Math.min(marquee.sx,marquee.x)} y={Math.min(marquee.sy,marquee.y)} width={Math.abs(marquee.x-marquee.sx)} height={Math.abs(marquee.y-marquee.sy)} fill="var(--accent-soft)" fillOpacity=".55" stroke="var(--accent)" strokeWidth={1.5/view.k} strokeDasharray={`${5/view.k} ${3/view.k}`} pointerEvents="none" />}
          {project.links.map((l) => {
            const a = devPos(l.a.device), b = devPos(l.b.device);
            const da = getDevice(project, l.a.device), db = getDevice(project, l.b.device);
            if (!da || !db) return null;
            const sa = portState(project, da, l.a.port), sb = portState(project, db, l.b.port);
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
            const sel = isSelected({ type: 'link', id: l.id });
            const up = sa === 'up' && sb === 'up';
            const active = anim?.hop?.linkId === l.id;
            const wireless = /^(WiFi|Radio|DECT)/.test(l.a.port) || /^(WiFi|Radio|DECT)/.test(l.b.port);
            const end = (s: PortState, port: string, dev: Device, sign: 1 | -1, base: { x: number; y: number }) => {
              const short = dev.ports.find((p) => p.name === port)?.short ?? port;
              const dx = base.x + ux * sign * 40, dy = base.y + uy * sign * 40;
              const dist = Math.min(uy * sign > 0.3 ? 104 : 76, len / 2 - 10);
              const lx = base.x + ux * sign * dist, ly = base.y + uy * sign * dist;
              const w = short.length * 6.3 + 10;
              return (<g key={port}>
                <circle cx={dx} cy={dy} r={5} fill={STATE_COLOR[s]} stroke="var(--canvas)" strokeWidth={2}><title>{`${dev.name} ${short} : ${s === 'up' ? 'actif' : s === 'admin-down' ? 'désactivé (shutdown)' : 'inactif'}`}</title></circle>
                {showPorts && len > 130 && <g><rect x={lx - w / 2} y={ly - 9} width={w} height={17} rx={6} className="port-bg" /><text x={lx} y={ly + 3.5} textAnchor="middle" className="port-label">{short}</text></g>}
              </g>);
            };
            return (
              <g key={l.id} onPointerDown={(e) => { if (e.button === 0) e.stopPropagation(); }} onPointerUp={(e) => { if (e.button === 0 && !pan) { e.stopPropagation(); if (!drag) onSelect({ type: 'link', id: l.id }, multiMode || e.shiftKey || e.ctrlKey || e.metaKey); } }} style={{ cursor: 'pointer' }}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel || active ? 'var(--accent)' : up ? 'var(--text-2)' : (sa === 'admin-down' || sb === 'admin-down') ? 'var(--red)' : 'var(--border-strong)'} strokeWidth={sel || active ? 3 : 2} strokeDasharray={wireless ? '5 5' : up ? undefined : '6 5'} opacity={up || sel ? 0.9 : 1} />
                {!up && (sa === 'admin-down' || sb === 'admin-down') && <g transform={`translate(${(a.x+b.x)/2},${(a.y+b.y)/2})`}><circle r="9" fill="var(--red)" stroke="var(--surface)" strokeWidth="2"/><text textAnchor="middle" y="4" fill="white" fontSize="12" fontWeight="bold">!</text><title>Liaison inactive : un port est désactivé</title></g>}
                {end(sa, l.a.port, da, 1, a)}{end(sb, l.b.port, db, -1, b)}
              </g>
            );
          })}
          {showPorts && project.links.map(l => { const a=devPos(l.a.device), b=devPos(l.b.device), da=getDevice(project,l.a.device), db=getDevice(project,l.b.device); if (!da || !db) return null; const len=Math.hypot(b.x-a.x,b.y-a.y)||1; if(len<=130)return null; const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len; return <g key={`labels-${l.id}`} pointerEvents="none">{([[da,l.a.port,1,a],[db,l.b.port,-1,b]] as [Device,string,number,{x:number;y:number}][]).map(([d,port,sign,base]) => { const short=d.ports.find(p=>p.name===port)?.short??port, dist=Math.min(uy*sign>0.3?104:76,len/2-10), x=base.x+ux*sign*dist,y=base.y+uy*sign*dist,w=short.length*6.3+10; return <g key={d.id+port}><rect x={x-w/2} y={y-9} width={w} height={17} rx={6} className="port-bg"/><text x={x} y={y+3.5} textAnchor="middle" className="port-label">{short}</text></g>; })}</g>; })}
          {pending && mouse && (() => { const p = devPos(pending.device); return <line x1={p.x} y1={p.y} x2={mouse.x} y2={mouse.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 5" pointerEvents="none" />; })()}
          {project.devices.map((d) => {
            const p = posOf({ type: 'device', id: d.id }, d.x, d.y);
            const m = getModel(d.modelId);
            const sel = isSelected({ type: 'device', id: d.id });
            const flash = anim && !anim.hop && anim.at === d.id ? anim.status : null;
            const isPending = pending?.device === d.id;
            return (
              <g key={d.id} opacity={d.poweredOn === false ? .48 : 1} transform={`translate(${p.x},${p.y})`} onPointerDown={(e) => startDrag(e, { type: 'device', id: d.id }, d.x, d.y)} onDoubleClick={(e) => { e.stopPropagation(); props.onOpen(d.id); }} style={{ cursor: tool === 'cable' ? 'crosshair' : 'grab' }}>
                <rect x={-TILE / 2} y={-TILE / 2} width={TILE} height={TILE} fill="transparent" pointerEvents="all" />
                {(sel || isPending) && <rect x={-TILE / 2 - 5} y={-TILE / 2 - 5} width={TILE + 10} height={TILE + 10} rx={19} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
                {flash && <rect x={-TILE / 2 - 7} y={-TILE / 2 - 7} width={TILE + 14} height={TILE + 14} rx={21} fill="none" stroke={flash === 'fail' ? 'var(--red)' : flash === 'ok' ? 'var(--green)' : 'var(--accent)'} strokeWidth={3} opacity={0.85} />}
                <foreignObject x={-TILE / 2} y={-TILE / 2} width={TILE} height={TILE} style={{ pointerEvents: 'none' }}>
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}><DeviceIcon kind={m.kind} modelId={m.id} size={64} /></div>
                </foreignObject>
                {props.printingId === d.id && <g className="printing-marker"><rect x="-42" y="-57" width="84" height="20" rx="10" fill="var(--accent)"/><text textAnchor="middle" y="-43" fill="white" fontSize="10" fontWeight="bold">Impression…</text></g>}
                {d.poweredOn === false && <text y={-TILE / 2 - 10} textAnchor="middle" fontSize="11" fill="var(--text)">Éteint</text>}
                <text y={TILE / 2 + 17} textAnchor="middle" className="node-label">{d.name}</text>
                {view.k >= 0.7 && <text y={TILE / 2 + 31} textAnchor="middle" className="node-sub">{m.vendor === 'Générique' ? m.label : `${m.vendor === 'Allied Telesis' ? 'AT' : 'Cisco'} ${m.label}`}</text>}
              </g>
            );
          })}
          {project.notes.map((n) => {
            const p = posOf({ type: 'note', id: n.id }, n.x, n.y);
            const sel = isSelected({ type: 'note', id: n.id });
            return (
              <foreignObject key={n.id} x={p.x} y={p.y} width={240} height={120} style={{ overflow: 'visible' }} onPointerDown={(e) => startDrag(e, { type: 'note', id: n.id }, n.x, n.y)}>
                <div className={`note-box ${sel ? 'sel' : ''}`}>{n.text || 'Note'}</div>
              </foreignObject>
            );
          })}
          {packet && anim && (
            <g transform={`translate(${packet.x},${packet.y})`} pointerEvents="none">
              <rect x={-15} y={-10} width={30} height={20} rx={5} fill={KIND_COLOR[anim.kind] ?? 'var(--accent)'} stroke="#fff" strokeWidth={1.5} />
              <path d="M-11 -6 L0 2 L11 -6" fill="none" stroke="#fff" strokeWidth={1.6} />
              <text y={-15} textAnchor="middle" className="port-label" style={{ fill: KIND_COLOR[anim.kind] }}>{anim.kind}{anim.hop?.tag ? ` · VLAN ${anim.hop.tag}` : ''}</text>
            </g>
          )}
        </g>
      </svg>

      <div className="canvas-tools">
        <div className="toolgroup" role="toolbar" aria-label="Outils">
          <button className={tool === 'select' ? 'on' : ''} onClick={() => props.setTool('select')} title="Sélection (V)"><Icon.cursor size={16} /></button>
          <button disabled={!props.editable} className={tool === 'cable' ? 'on' : ''} onClick={() => props.setTool(tool === 'cable' ? 'select' : 'cable')} title="Relier : câble ou liaison radio (R)"><Icon.cable size={16} /><span className="btn-label">Relier</span></button>
          <button className={multiMode ? 'on' : ''} aria-label="Sélection multiple" aria-pressed={multiMode} title="Sélection multiple : sélectionner plusieurs éléments" onClick={() => { setMultiMode(!multiMode); props.setTool('select'); }}><Icon.check size={16} /></button>
          <button disabled={!props.editable} onClick={props.onAddNote} title="Ajouter une note (N)"><Icon.note size={16} /><span className="btn-label">Note</span></button>
        </div>
        <div className="toolgroup">
          <button onClick={() => zoomBy(1 / 1.2)} title="Dézoomer" aria-label="Dézoomer"><Icon.minus size={16} /></button>
          <span className="zoom">{Math.round(view.k * 100)} %</span>
          <button onClick={() => zoomBy(1.2)} title="Zoomer" aria-label="Zoomer"><Icon.plus size={16} /></button>
          <button onClick={fit} title="Ajuster à l’écran (F)" aria-label="Ajuster à l’écran"><Icon.fit size={16} /></button>
        </div>
      </div>
      {props.editable && tool === 'select' && !drag && selection.length === 1 && selection[0].type === 'device' && (() => { const d=getDevice(project,selection[0].id); if(!d) return null; const left=Math.max(8,Math.min((wrap.current?.clientWidth ?? 300)-260,view.x+d.x*view.k-130)); const top=Math.max(58,view.y+(d.y-48)*view.k-42); if(top > (wrap.current?.clientHeight ?? 0)-44) return null; const model=getModel(d.modelId); return <div className="context-tools" style={{left,top}} aria-label={`Actions pour ${d.name}`}><button onClick={()=>props.onContext('cable',d.id)}><Icon.cable size={14}/>Relier</button>{model.os !== 'bridge' && model.os !== 'filter' && <button disabled={d.poweredOn === false} onClick={()=>props.onContext('terminal',d.id)}><Icon.terminal size={14}/>Terminal</button>}{model.os === 'host' && <button onClick={()=>props.onContext('ip',d.id)}>Config IP</button>}<button className="danger" onClick={()=>props.onContext('delete',d.id)} aria-label="Supprimer l’équipement"><Icon.trash size={14}/></button></div>; })()}
      {tool === 'cable' && <div className="cable-hint">{pending ? `Cliquez sur le second équipement (${getDevice(project, pending.device)?.name} ${pending.port}) — Échap pour annuler` : 'Choisissez un équipement puis son port ; répétez pour le second.'}</div>}
      {picker && pickerDev && (
        <div className="port-picker" style={{ left: picker.x, top: picker.y }} onPointerDown={(e) => e.stopPropagation()}>
          <h5>{pickerDev.name} — choisir un port</h5>
          {pickerDev.ports.map((pt) => {
            const l = findLink(project, pickerDev.id, pt.name);
            const peer = l && otherEnd(l, pickerDev.id, pt.name);
            const peerDev = peer && getDevice(project, peer.device);
            return (
              <button key={pt.name} disabled={!!l} onClick={() => choosePort(pt.name)}>
                <span>{pt.name}</span>
                <span className="pill">{l ? `→ ${peerDev?.name}` : pt.speed}</span>
              </button>
            );
          })}
        </div>
      )}
      {props.children}
    </div>
  );
});
