// Analyse des noms d'interfaces Cisco IOS et AlliedWare Plus.
import type { Device } from '../model/types';
import { getModel } from '../devices/catalog';

const CISCO_TYPES = [
  { full: 'FastEthernet', short: 'Fa' },
  { full: 'GigabitEthernet', short: 'Gi' },
  { full: 'Vlan', short: 'Vlan' },
];

export type CiscoIf =
  | { kind: 'ports'; names: string[] }
  | { kind: 'subif'; parent: string; name: string }
  | { kind: 'svi'; vlan: number }
  | { kind: 'error'; msg: string };

function ciscoType(word: string) {
  const w = word.toLowerCase();
  return CISCO_TYPES.find((t) => t.full.toLowerCase().startsWith(w));
}

export function parseCiscoIf(dev: Device, text: string): CiscoIf {
  const os = getModel(dev.modelId).os;
  const t = text.trim();
  const rangeM = /^range\s+(.+)$/i.exec(t);
  if (rangeM) {
    const names: string[] = [];
    for (const item of rangeM[1].split(',')) {
      const m = /^\s*([a-zA-Z]+)\s*(\d+)\/(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(item);
      if (!m) return { kind: 'error', msg: 'invalid' };
      const ty = ciscoType(m[1]);
      if (!ty || ty.full === 'Vlan') return { kind: 'error', msg: 'invalid' };
      const lo = +m[3], hi = m[4] ? +m[4] : lo;
      if (hi < lo) return { kind: 'error', msg: 'invalid' };
      for (let i = lo; i <= hi; i++) {
        const name = `${ty.full}${m[2]}/${i}`;
        if (!dev.ports.some((p) => p.name === name)) return { kind: 'error', msg: 'invalid' };
        names.push(name);
      }
    }
    return { kind: 'ports', names };
  }
  const m = /^([a-zA-Z]+)\s*(\d+(?:\/\d+)*)(?:\.(\d+))?$/.exec(t);
  if (!m) return { kind: 'error', msg: 'invalid' };
  const ty = ciscoType(m[1]);
  if (!ty) return { kind: 'error', msg: 'invalid' };
  if (ty.full === 'Vlan') {
    if (os !== 'ios-switch' || m[2].includes('/') || m[3]) return { kind: 'error', msg: 'invalid' };
    const v = +m[2];
    if (v < 1 || v > 4094) return { kind: 'error', msg: 'invalid' };
    return { kind: 'svi', vlan: v };
  }
  const name = `${ty.full}${m[2]}`;
  if (!dev.ports.some((p) => p.name === name)) return { kind: 'error', msg: 'invalid' };
  if (m[3] !== undefined) {
    if (os !== 'ios-router') return { kind: 'error', msg: 'invalid' };
    const n = +m[3];
    if (n < 1 || n > 4294967295) return { kind: 'error', msg: 'invalid' };
    return { kind: 'subif', parent: name, name: `${name}.${n}` };
  }
  return { kind: 'ports', names: [name] };
}

export type AwIf = { kind: 'ports'; names: string[] } | { kind: 'svi'; vlan: number } | { kind: 'error'; msg: string };
export function parseAwIf(dev: Device, text: string): AwIf {
  const t = text.trim();
  const eth = /^eth\d+$/i.exec(t);
  if (eth) { const port = dev.ports.find(p => p.name.toLowerCase() === t.toLowerCase()); return port ? {kind: 'ports', names: [port.name]} : {kind: 'error', msg: 'invalid'}; }
  const v = /^vlan(\d+)$/i.exec(t);
  if (v) return +v[1] >= 1 && +v[1] <= 4094 ? { kind: 'svi', vlan: +v[1] } : { kind: 'error', msg: 'invalid' };
  const names: string[] = [];
  for (const item of t.split(',')) {
    const m = /^port(\d+)\.(\d+)\.(\d+)(?:-(?:port)?(\d+)\.(\d+)\.(\d+))?$/i.exec(item.trim());
    if (!m) return { kind: 'error', msg: 'invalid' };
    const lo = +m[3];
    const hi = m[6] !== undefined ? +m[6] : lo;
    if (m[4] !== undefined && (m[4] !== m[1] || m[5] !== m[2])) return { kind: 'error', msg: 'invalid' };
    if (hi < lo) return { kind: 'error', msg: 'invalid' };
    for (let i = lo; i <= hi; i++) {
      const name = `port${m[1]}.${m[2]}.${i}`;
      if (!dev.ports.some((p) => p.name === name)) return { kind: 'error', msg: `% ${name} does not exist` };
      names.push(name);
    }
  }
  return { kind: 'ports', names };
}
