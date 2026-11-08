// Dock de terminaux : un onglet par équipement, avec historique, Tab, « ? », Ctrl+Z, collage multi-lignes.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../model/types';
import type { Shell } from '../cli';
import { getDevice } from '../model/project';
import { getModel } from '../devices/catalog';
import { Icon } from './icons';
import { isIp } from '../sim/ip';

interface Line { text: string; cls?: string }
type PingStyle = 'windows' | 'ios' | 'awplus';
interface PingJob { style: PingStyle; marks?: Line; target: string; count: number; sent: number; received: number; replies: number; timer?: ReturnType<typeof setTimeout>; lastFailure?: string }
interface Session { lines: Line[]; history: string[]; hIdx: number; input: string; ping?: PingJob }

interface Props {
  project: Project;
  tabs: string[];
  active: string | null;
  setActive(id: string): void;
  close(id: string): void;
  getShell(id: string): Shell | null;
  collapsed: boolean;
  setCollapsed(v: boolean): void;
  guardCommand(line: string, run: () => void): void;
}

const MAX_LINES = 2000;

export function TerminalDock(props: Props) {
  const { project, tabs, active, collapsed } = props;
  const sessions = useRef(new Map<string, Session>());
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const shell = active ? props.getShell(active) : null;
  const dev = active ? getDevice(project, active) : undefined;

  function session(id: string): Session {
    let s = sessions.current.get(id);
    if (!s) {
      s = { lines: [], history: [], hIdx: -1, input: '' };
      const sh = props.getShell(id);
      const d = getDevice(project, id);
      if (sh && d) {
        s.lines.push({ text: `Connexion console à ${d.name} (${getModel(d.modelId).label})`, cls: 'meta' });
        safe(() => sh.banner()).forEach((t) => s!.lines.push(toLine(t)));
      }
      sessions.current.set(id, s);
    }
    return s;
  }
  // nettoyer les sessions fermées
  useEffect(() => { for (const id of [...sessions.current.keys()]) if (!tabs.includes(id)) { const job = sessions.current.get(id)?.ping; if (job?.timer) clearTimeout(job.timer); sessions.current.delete(id); } }, [tabs]);
  useEffect(() => () => { for (const v of sessions.current.values()) if (v.ping?.timer) clearTimeout(v.ping.timer); }, []);

  const s = active ? session(active) : null;

  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffect(() => { if (!collapsed) input.current?.focus(); }, [active, collapsed]);

  function push(lines: (string | Line)[]) {
    if (!s) return;
    for (const l of lines) s.lines.push(typeof l === 'string' ? toLine(l) : l);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
  }

  function finishPing(session: Session, interrupted = false) {
    const j = session.ping; if (!j) return;
    if (j.timer) clearTimeout(j.timer);
    if (interrupted) session.lines.push({ text: '^C', cls: 'echo' });
    const loss = j.sent ? Math.round(100 * (j.sent - j.replies) / j.sent) : 0;
    if (j.style === 'windows') {
      session.lines.push({ text: '' }, { text: `Statistiques Ping pour ${j.target} :` },
        { text: `    Paquets : envoyés = ${j.sent}, reçus = ${j.received}, perdus = ${j.sent - j.received} (${j.sent ? Math.round(100 * (j.sent - j.received) / j.sent) : 0}% de perte)` });
      if (j.replies) session.lines.push({ text: 'Durée simulée : moins de 1 ms (pas une mesure réelle).' });
    } else if (j.style === 'ios') {
      session.lines.push({ text: `Success rate is ${j.sent ? Math.round(100 * j.replies / j.sent) : 0} percent (${j.replies}/${j.sent})` });
    } else {
      session.lines.push({ text: '' }, { text: `--- ${j.target} ping statistics ---` }, { text: `${j.sent} packets transmitted, ${j.replies} received, ${loss}% packet loss` });
    }
    if (j.lastFailure) session.lines.push({ text: 'ⓘ Pour comprendre l’échec, utilisez le mode Simulation.', cls: 'hint' });
    session.lines.push({ text: '' }); session.ping = undefined; rerender();
  }
  function startPing(session: Session, sh: Shell, target: string, count: number, style: PingStyle) {
    const job: PingJob = { style, target, count, sent: 0, received: 0, replies: 0 };
    session.ping = job;
    if (style === 'windows') session.lines.push({ text: '' }, { text: `Envoi d’une requête 'Ping' à ${target} avec 32 octets de données :` }, { text: '' });
    else if (style === 'ios') { session.lines.push({ text: 'Ctrl+C pour arrêter.', cls: 'hint' }, { text: `Sending ${count}, 100-byte ICMP Echos to ${target}:` }); job.marks = {text:''}; session.lines.push(job.marks); }
    else session.lines.push({ text: `PING ${target} (${target}) 56(84) bytes of data.` });
    const step = () => {
      if (session.ping !== job) return;
      const r = sh.pingProbe!(target); job.sent++;
      if (r.success) { job.received++; job.replies++; }
      else { job.lastFailure = r.reason || 'Échec'; if (style === 'windows' && r.outcome === 'unreachable' && r.replyFrom) job.received++; }
      if (style === 'windows') {
        if (r.success) session.lines.push({ text: `Réponse de ${target} : octets=32 temps<1 ms TTL=${r.ttl}` });
        else if (r.outcome === 'unreachable' && r.replyFrom) session.lines.push({ text: `Réponse de ${r.replyFrom} : impossible de joindre l’hôte de destination.` });
        else session.lines.push({ text: 'Délai d’attente de la demande dépassé.' });
      } else if (style === 'ios') job.marks!.text += r.success ? '!' : r.outcome === 'unreachable' ? 'U' : '.';
      else if (r.success) session.lines.push({ text: `64 bytes from ${target}: icmp_seq=${job.sent} ttl=${r.ttl} time<1 ms` });
      else if (r.outcome === 'unreachable' && r.replyFrom) session.lines.push({ text: `From ${r.replyFrom} icmp_seq=${job.sent} Destination Host Unreachable` });
      rerender();
      if (job.sent >= job.count) finishPing(session);
      else job.timer = setTimeout(step, 1000);
    };
    job.timer = setTimeout(step, 300); rerender();
  }
  function parsePing(line: string): { target: string; count: number } | null {
    const m = /^\s*ping\s+(?:(?:-n\s+(\d+)\s+)?(\S+)|(?:(\S+)\s+-n\s+(\d+)))\s*$/i.exec(line);
    if (!m) return null;
    const target = m[2] ?? m[3], count = Math.max(1, Math.min(20, +(m[1] ?? m[4] ?? 4) || 4));
    return isIp(target) ? { target, count } : null;
  }

  function run(line: string) {
    if (!s || !shell || s.ping) return;
    const prompt = shell.prompt();
    const masked = shell.masked;
    push([{ text: prompt + (masked ? '' : line), cls: 'echo' }]);
    if (!masked && line.trim()) { s.history.push(line); if (s.history.length > 200) s.history.shift(); }
    s.hIdx = -1;
    if (dev && getModel(dev.modelId).os === 'host' && line.trim().toLowerCase() === 'cls') { s.lines = []; return; }
    const style = shell.pingMode?.();
    const ping = style && shell.pingProbe && (style === 'windows' || /^\s*ping\s+\S+\s*$/i.test(line)) ? parsePing(line) : null;
    if (ping && style) { startPing(s, shell, ping.target, style === 'windows' ? ping.count : 5, style); return; }
    push(safe(() => shell.exec(line)));
  }

  function setInput(v: string) { if (s) { s.input = v; rerender(); } }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!s || !shell) return;
    const v = s.input;
    if (s.ping) { if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); finishPing(s, true); } else if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      props.guardCommand(v, () => { run(v); s.input = ''; rerender(); });
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); if (!shell.masked) setInput(safeStr(() => shell.complete(v), v)); return; }
    if (e.key === '?' && shell.questionHelp && !shell.masked) {
      e.preventDefault();
      push([{ text: shell.prompt() + v + '?', cls: 'echo' }, ...safe(() => shell.help(v))]);
      rerender(); return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault(); if (!s.history.length) return;
      s.hIdx = s.hIdx < 0 ? s.history.length - 1 : Math.max(0, s.hIdx - 1);
      setInput(s.history[s.hIdx]); return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault(); if (s.hIdx < 0) return;
      s.hIdx++; if (s.hIdx >= s.history.length) { s.hIdx = -1; setInput(''); } else setInput(s.history[s.hIdx]);
      return;
    }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); push([{ text: shell.prompt() + v + '^Z', cls: 'echo' }, ...safe(() => shell.ctrlZ())]); s.input = ''; rerender(); return; }
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !window.getSelection()?.toString()) { e.preventDefault(); push([{ text: shell.prompt() + v + '^C', cls: 'echo' }]); s.input = ''; rerender(); return; }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); s.lines = []; rerender(); return; }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (!s || !shell) return;
    if (s.ping) { e.preventDefault(); return; }
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const joined = s.input + text;
    props.guardCommand(joined, () => {
      const lines = joined.replace(/\r\n?/g, '\n').split('\n');
      const last = lines.pop() ?? '';
      for (let i = 0; i < lines.length; i++) { run(lines[i]); if (s.ping) { if (i < lines.length - 1 || last) s.lines.push({ text: 'ⓘ Collage interrompu pendant le ping ; relancez les lignes restantes après le test.', cls: 'hint' }); break; } }
      s.input = s.ping ? '' : last; rerender();
    });
  }

  return (
    <section className={`dock${collapsed ? ' collapsed' : ''}`} aria-label="Terminaux">
      <div className="dock-tabs" role="tablist">
        <button className="btn ghost icon" onClick={() => props.setCollapsed(!collapsed)} title={collapsed ? 'Afficher les terminaux' : 'Réduire'} aria-label={collapsed ? 'Afficher les terminaux' : 'Réduire les terminaux'}>
          <Icon.terminal size={16} />
        </button>
        {tabs.length === 0 && <span className="shortcuts"><span><kbd>Double-clic</kbd> Terminal</span><span><kbd>R</kbd> Relier</span><span><kbd>Suppr</kbd> Effacer</span></span>}
        {tabs.map((id) => {
          const d = getDevice(project, id);
          return (
            <div key={id} role="tab" aria-selected={id === active} className={`dock-tab${id === active ? ' on' : ''}`} onClick={() => { props.setActive(id); props.setCollapsed(false); }}>
              {d?.name ?? '(supprimé)'}
              <span className="close" role="button" aria-label={`Fermer le terminal de ${d?.name ?? ''}`} onClick={(e) => { e.stopPropagation(); props.close(id); }}><Icon.x size={13} /></span>
            </div>
          );
        })}
      </div>
      {!collapsed && (
        <div className="term" ref={scroller} onMouseUp={() => { if (!window.getSelection()?.toString()) input.current?.focus(); }}>
          {!s && <div className="term-meta">Aucun terminal ouvert. Sélectionnez un équipement puis « Terminal (CLI) », ou double-cliquez dessus.</div>}
          {s && !shell && <div className="term-meta">Cet équipement n’existe plus.</div>}
          {s && <pre>{s.lines.map((l, i) => <div key={i} className={l.cls}>{l.text || '\u00a0'}</div>)}</pre>}
          {s && shell && (
            <div className="inputline">
              <pre>{s.ping ? 'Ping en cours — Ctrl+C pour arrêter' : shell.prompt()}</pre>
              <input readOnly={!!s.ping} ref={input} value={s.input} type={shell.masked ? 'password' : 'text'} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
                aria-label={`Ligne de commande de ${dev?.name ?? ''}`} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function toLine(t: string): Line { return t.startsWith('ⓘ ') ? { text: t, cls: 'hint' } : { text: t }; }
function safe(f: () => string[]): string[] { try { return f(); } catch (e) { return [`ⓘ ${(e as Error).message}`]; } }
function safeStr(f: () => string, d: string): string { try { return f(); } catch { return d; } }
