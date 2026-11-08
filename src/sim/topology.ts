// Lecture de l'état de la topologie : état des ports, interfaces de niveau 3.
import type { Project, Device, Port } from '../model/types';
import { findLink, otherEnd, getDevice, getPort } from '../model/project';
import { getModel } from '../devices/catalog';

export type PortState = 'up' | 'down' | 'admin-down';

export function kindOf(d: Device) { return getModel(d.modelId).kind; }
export function osOf(d: Device) { return getModel(d.modelId).os; }
export function isSwitch(d: Device) { return kindOf(d) === 'switch' || kindOf(d) === 'ap'; }
export function isHost(d: Device) { return osOf(d) === 'host'; }
export function isRouter(d: Device) { return kindOf(d) === 'router' || kindOf(d) === 'firewall'; }
export function isRoutingDevice(d: Device) { return isRouter(d) || (d.modelId === 'cisco-3560' && d.config.ipRouting === true); }

export function peerPort(p: Project, d: Device, port: string): { dev: Device; port: Port } | null {
  const l = findLink(p, d.id, port);
  if (!l) return null;
  const o = otherEnd(l, d.id, port);
  const od = getDevice(p, o.device);
  const op = od && getPort(od, o.port);
  return od && op ? { dev: od, port: op } : null;
}

/** État opérationnel d'un port : actif seulement si câblé et activé des deux côtés. */
export function portState(p: Project, d: Device, portName: string): PortState {
  const port = getPort(d, portName);
  if (!port) return 'down';
  if (d.poweredOn === false) return 'down';
  if (!port.adminUp) return 'admin-down';
  const peer = peerPort(p, d, portName);
  if (!peer || peer.dev.poweredOn === false || !peer.port.adminUp) return 'down';
  return 'up';
}
export const portUp = (p: Project, d: Device, n: string) => portState(p, d, n) === 'up';

export function vlanExists(d: Device, v: number) { return !!d.config.vlans?.some((x) => x.id === v); }
export function trunkAllows(port: Port, v: number) {
  return port.trunkAllowed === 'all' || (Array.isArray(port.trunkAllowed) && port.trunkAllowed.includes(v));
}

export function portCarriesVlan(port: Port, v: number, os?: string): boolean {
  if (port.mode === 'trunk') {
    // AlliedWare Plus : le VLAN natif est toujours transporté (non étiqueté) ; Cisco : il doit figurer dans la liste autorisée.
    if (os === 'awplus' && port.nativeVlan === v) return true;
    return trunkAllows(port, v);
  }
  return (port.accessVlan ?? 1) === v;
}

export type Attach = { type: 'port'; port: string; vlan: number | null } | { type: 'svi'; vlan: number };
export interface L3If {
  dev: Device;
  name: string;
  ip: string;
  mask: string;
  up: boolean;
  mac: string;
  attach: Attach;
  aclIn?: string;
  aclOut?: string;
}

export function sviUp(p: Project, d: Device, vlan: number): boolean {
  const svi = d.config.svis?.find((s) => s.vlan === vlan);
  if (!svi || !svi.adminUp || !vlanExists(d, vlan)) return false;
  const os = osOf(d);
  return d.ports.some((pt) => portUp(p, d, pt.name) && portCarriesVlan(pt, vlan, os));
}

export function sviName(d: Device, vlan: number) { return osOf(d) === 'awplus' ? `vlan${vlan}` : `Vlan${vlan}`; }

/** Toutes les interfaces de niveau 3 (y compris sans adresse IP si includeNoIp). */
export function l3Interfaces(p: Project, d: Device, includeNoIp = false): L3If[] {
  const out: L3If[] = [];
  const os = osOf(d);
  if (os === 'host') {
    const port = d.ports[0];
    const h = d.config.host!;
    if (h.ip || includeNoIp) out.push({ dev: d, name: port.name, ip: h.ip, mask: h.mask, up: portUp(p, d, port.name) && !!h.ip, mac: port.mac, attach: { type: 'port', port: port.name, vlan: null } });
  } else if (isRouter(d)) {
    for (const port of d.ports) {
      if (port.ip || includeNoIp) out.push({ dev: d, name: port.name, ip: port.ip ?? '', mask: port.mask ?? '', up: portUp(p, d, port.name) && !!port.ip, mac: port.mac, attach: { type: 'port', port: port.name, vlan: null }, aclIn: port.aclIn, aclOut: port.aclOut });
    }
    for (const s of d.config.subifs ?? []) {
      const parent = getPort(d, s.parent);
      if (!parent || s.vlan === undefined) continue;
      if (s.ip || includeNoIp) out.push({ dev: d, name: s.name, ip: s.ip ?? '', mask: s.mask ?? '', up: portUp(p, d, parent.name) && s.adminUp && !!s.ip, mac: parent.mac, attach: { type: 'port', port: parent.name, vlan: s.vlan }, aclIn: s.aclIn, aclOut: s.aclOut });
    }
  } else if (isSwitch(d)) {
    for (const s of d.config.svis ?? []) {
      if (s.ip || includeNoIp) out.push({ dev: d, name: sviName(d, s.vlan), ip: s.ip ?? '', mask: s.mask ?? '', up: sviUp(p, d, s.vlan) && !!s.ip, mac: d.ports[0].mac, attach: { type: 'svi', vlan: s.vlan } });
    }
  }
  return out;
}

export function ownsIp(p: Project, d: Device, ip: string) { return l3Interfaces(p, d).some((i) => i.ip === ip); }

export function linkState(p: Project, linkId: string): { a: PortState; b: PortState } | null {
  const l = p.links.find((x) => x.id === linkId);
  if (!l) return null;
  const da = getDevice(p, l.a.device), db = getDevice(p, l.b.device);
  if (!da || !db) return null;
  return { a: portState(p, da, l.a.port), b: portState(p, db, l.b.port) };
}
