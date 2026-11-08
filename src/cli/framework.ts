// Mini-framework de ligne de commande : arbre de commandes, abréviations, Tab, « ? », erreurs.
import type { Project, Device } from '../model/types';
import type { Runtime } from '../sim/runtime';
import type { PingResult } from '../sim/engine';
import { isIp, isMask, parseCidr } from '../sim/ip';

export interface ShellCtx { get(): Project; set(p: Project): void; rt: Runtime; deviceId: string }

export interface Shell {
  prompt(): string;
  exec(line: string): string[];
  pingProbe?(target: string): PingResult;
  pingMode?(): 'windows' | 'ios' | 'awplus' | null;
  complete(line: string): string;
  help(line: string): string[];
  banner(): string[];
  ctrlZ(): string[];
  /** « ? » affiche l'aide immédiatement (comportement IOS / AlliedWare Plus) */
  questionHelp: boolean;
  /** saisie masquée (mot de passe) */
  masked: boolean;
}

export interface Param { name: string; help: string; test: (t: string) => boolean; rest?: boolean }
export interface Node { kw?: string; param?: Param; help: string; children?: Node[]; run?: (w: string[]) => void }

export function k(kw: string, help: string, next?: Node[] | ((w: string[]) => void), run?: (w: string[]) => void): Node {
  const n: Node = { kw, help };
  if (Array.isArray(next)) { n.children = next; if (run) n.run = run; } else if (next) n.run = next;
  return n;
}
export function a(param: Param, next?: Node[] | ((w: string[]) => void), run?: (w: string[]) => void): Node {
  const n: Node = { param, help: param.help };
  if (Array.isArray(next)) { n.children = next; if (run) n.run = run; } else if (next) n.run = next;
  return n;
}

export const P = {
  ip: (help = 'IP address'): Param => ({ name: 'A.B.C.D', help, test: isIp }),
  mask: (help = 'IP subnet mask'): Param => ({ name: 'A.B.C.D', help, test: isMask }),
  cidr: (help = 'IP address with prefix length'): Param => ({ name: 'A.B.C.D/M', help, test: (t) => !!parseCidr(t) }),
  num: (lo: number, hi: number, help: string): Param => ({ name: `<${lo}-${hi}>`, help, test: (t) => /^\d+$/.test(t) && +t >= lo && +t <= hi }),
  word: (name: string, help: string): Param => ({ name, help, test: (t) => t.length > 0 }),
  line: (name: string, help: string): Param => ({ name, help, test: () => true, rest: true }),
  vlanList: (help = 'VLAN IDs of the allowed VLANs when this port is in trunking mode'): Param => ({ name: 'WORD', help, test: (t) => parseVlanList(t) !== null }),
};

export function parseVlanList(s: string): number[] | null {
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const lo = +m[1], hi = m[2] ? +m[2] : lo;
    if (lo < 1 || hi > 4094 || lo > hi) return null;
    for (let v = lo; v <= hi; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
export function formatVlanList(v: number[]): string {
  const s = [...v].sort((x, y) => x - y);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i + 1 ? `${s[i]}-${s[j]}` : j === i + 1 ? `${s[i]},${s[j]}` : `${s[i]}`);
    i = j;
  }
  return parts.join(',');
}

export interface Tok { t: string; pos: number }
export function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ t: m[0], pos: m.index });
  return out;
}

type Match = { st: 'one'; node: Node } | { st: 'amb' } | { st: 'none' };
function matchTok(level: Node[], t: string): Match {
  const lower = t.toLowerCase();
  const kws = level.filter((n) => n.kw);
  const exact = kws.find((n) => n.kw!.toLowerCase() === lower);
  if (exact) return { st: 'one', node: exact };
  const pre = kws.filter((n) => n.kw!.toLowerCase().startsWith(lower));
  if (pre.length === 1) return { st: 'one', node: pre[0] };
  const params = level.filter((n) => n.param && n.param.test(t));
  if (pre.length > 1) return params.length ? { st: 'one', node: params[0] } : { st: 'amb' };
  if (params.length) return { st: 'one', node: params[0] };
  return { st: 'none' };
}

export type ParseRes = { st: 'ok'; node: Node; words: string[] } | { st: 'invalid'; idx: number } | { st: 'ambiguous'; idx: number } | { st: 'incomplete' };
export function parse(nodes: Node[], toks: string[]): ParseRes {
  let level = nodes;
  let node: Node | null = null;
  const words: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const m = matchTok(level, toks[i]);
    if (m.st === 'none') return { st: 'invalid', idx: i };
    if (m.st === 'amb') return { st: 'ambiguous', idx: i };
    node = m.node;
    if (node.param?.rest) { words.push(toks.slice(i).join(' ')); return node.run ? { st: 'ok', node, words } : { st: 'incomplete' }; }
    words.push(node.kw ?? toks[i]);
    level = node.children ?? [];
    if (i < toks.length - 1 && level.length === 0) return { st: 'invalid', idx: i + 1 };
  }
  if (!node || !node.run) return { st: 'incomplete' };
  return { st: 'ok', node, words };
}

function walk(nodes: Node[], toks: string[]): Node[] | null {
  let level = nodes;
  for (const t of toks) {
    const m = matchTok(level, t);
    if (m.st !== 'one') return null;
    if (m.node.param?.rest) return [];
    level = m.node.children ?? [];
  }
  return level;
}
function walkNode(nodes: Node[], toks: string[]): Node | null {
  let level = nodes; let node: Node | null = null;
  for (const t of toks) {
    const m = matchTok(level, t);
    if (m.st !== 'one') return null;
    node = m.node; level = node.children ?? [];
  }
  return node;
}

export function helpFor(nodes: Node[], line: string): string[] {
  const toks = tokenize(line).map((x) => x.t);
  const endsSpace = line.length === 0 || /\s$/.test(line);
  if (!endsSpace) {
    const partial = toks.pop()!.toLowerCase();
    const level = walk(nodes, toks);
    if (!level) return ['% Unrecognized command'];
    const list = level.filter((n) => n.kw && n.kw.toLowerCase().startsWith(partial)).map((n) => n.kw!);
    const params = level.filter((n) => n.param && n.param.test(partial));
    if (!list.length && !params.length) return ['% Unrecognized command'];
    return [list.concat(params.map((n) => n.param!.name)).join('  ')];
  }
  const level = walk(nodes, toks);
  if (!level) return ['% Unrecognized command'];
  const node = toks.length ? walkNode(nodes, toks) : null;
  const items: [string, string][] = level.map((n) => [n.kw ?? n.param!.name, n.help]);
  items.sort((x, y) => (x[0].startsWith('<') || x[0].startsWith('A.') || x[0] === 'WORD' || x[0] === 'LINE' ? -1 : 0) - (y[0].startsWith('<') || y[0].startsWith('A.') || y[0] === 'WORD' || y[0] === 'LINE' ? -1 : 0));
  if (node?.run && !node.param?.rest) items.push(['<cr>', '']);
  if (node?.param?.rest) return [`  ${node.param.name}  ${node.help}`, '  <cr>'];
  const w = Math.max(10, ...items.map((i) => i[0].length)) + 2;
  return items.map(([x, h]) => `  ${x.padEnd(w)}${h}`);
}

export function completeFor(nodes: Node[], line: string): string {
  if (!line || /\s$/.test(line)) return line;
  const toks = tokenize(line);
  const last = toks[toks.length - 1];
  const level = walk(nodes, toks.slice(0, -1).map((x) => x.t));
  if (!level) return line;
  const cands = level.filter((n) => n.kw && n.kw.toLowerCase().startsWith(last.t.toLowerCase())).map((n) => n.kw!);
  if (!cands.length) return line;
  if (cands.length === 1) return line.slice(0, last.pos) + cands[0] + ' ';
  let pre = cands[0];
  for (const c of cands) while (!c.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1);
  return pre.length > last.t.length ? line.slice(0, last.pos) + pre : line;
}

/** Base commune : exécute chaque commande sur un brouillon du projet puis valide la modification. */
export abstract class BaseShell implements Shell {
  questionHelp = true;
  masked = false;
  p!: Project;
  dev!: Device;
  out: string[] = [];
  constructor(public ctx: ShellCtx) {}
  abstract prompt(): string;
  abstract handle(line: string): void;
  abstract helpLines(line: string): string[];
  abstract completeLine(line: string): string;
  banner(): string[] { return []; }
  ctrlZ(): string[] { return []; }
  protected load() {
    this.p = structuredClone(this.ctx.get());
    const d = this.p.devices.find((x) => x.id === this.ctx.deviceId);
    if (!d) throw new Error('Équipement supprimé');
    this.dev = d;
  }
  exec(line: string): string[] {
    this.load();
    const before = JSON.stringify(this.p);
    this.out = [];
    try { this.handle(line); } catch (e) { this.out.push(`ⓘ Erreur interne de la simulation : ${(e as Error).message}`); }
    if (JSON.stringify(this.p) !== before) { this.p.updatedAt = Date.now(); this.ctx.set(this.p); }
    return this.out;
  }
  help(line: string): string[] { this.load(); return this.helpLines(line); }
  complete(line: string): string { this.load(); return this.completeLine(line); }
  print(...l: string[]) { this.out.push(...l); }
  hint(s: string) { this.out.push(`ⓘ ${s}`); }
}
