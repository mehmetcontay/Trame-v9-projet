// Moteur de niveau 3 : routage IPv4, ARP, ICMP (ping / traceroute) et ACL.
// Chaque résultat est calculé à partir de l'état réel du projet ; aucune réussite n'est simulée.
import type { Project, Device, Acl } from '../model/types';
import { getDevice, getPort } from '../model/project';
import { inSubnet, maskToPrefix, networkOf, parseIp, wildcardMatch, isIp } from './ip';
import { L3If, l3Interfaces, isHost, isRouter, isSwitch, isRoutingDevice, osOf } from './topology';
import { Hop, l2Reach, reverseHops, ifKey } from './l2';
import { Runtime, learnArp, learnMac } from './runtime';

export type PacketKind = 'ARP' | 'ICMP' | 'DHCP';
export interface SimEvent {
  kind: PacketKind;
  at: string;                  // équipement concerné
  hop?: Hop;                   // si présent : le paquet traverse ce câble
  text: string;
  status: 'info' | 'ok' | 'fail';
  layer?: string;
}
export interface Packet { src: string; dst: string; ttl: number; type: 'echo-request' | 'echo-reply' }

type Fail = { ok: false; kind: 'timeout' | 'unreachable' | 'ttl'; reason: string; at: Device; replyFrom?: string; routers: RouterHop[] };
type Ok = { ok: true; dev: Device; ifc: L3If | null; ttl: number; routers: RouterHop[]; src: string };
export type DeliverResult = Ok | Fail;
export interface RouterHop { dev: Device; ip: string }

export function initialTtl(d: Device): number {
  const os = osOf(d);
  return os === 'host' ? 128 : os === 'awplus' ? 64 : 255;
}

// ---------- Routage ----------
export interface Route { type: 'C' | 'L' | 'S'; network: string; mask: string; prefix: number; ifc?: L3If; nextHop?: string; exitIf?: string }

export function routingTable(p: Project, d: Device): Route[] {
  const routes: Route[] = [];
  const ifs = l3Interfaces(p, d).filter((i) => i.up);
  for (const i of ifs) {
    const prefix = maskToPrefix(i.mask) ?? 32;
    routes.push({ type: 'C', network: networkOf(i.ip, i.mask), mask: i.mask, prefix, ifc: i });
    if (isRoutingDevice(d)) routes.push({ type: 'L', network: i.ip, mask: '255.255.255.255', prefix: 32, ifc: i });
  }
  for (const r of d.config.routes ?? []) {
    routes.push({ type: 'S', network: r.network, mask: r.mask, prefix: maskToPrefix(r.mask) ?? 0, nextHop: r.nextHop, exitIf: r.exitIf });
  }
  return routes;
}

export type Lookup = { ok: true; ifc: L3If; nextHop: string } | { ok: false; reason: string };

export function routeLookup(p: Project, d: Device, dst: string, depth = 0): Lookup {
  if (isHost(d)) {
    const i = l3Interfaces(p, d, true)[0];
    const h = d.config.host!;
    if (!h.ip) return { ok: false, reason: `${d.name} n'a pas d'adresse IP configurée.` };
    if (!i.up) return { ok: false, reason: `La carte réseau de ${d.name} est inactive (câble absent, ou port en face désactivé).` };
    if (inSubnet(dst, h.ip, h.mask)) return { ok: true, ifc: i, nextHop: dst };
    if (!h.gateway) return { ok: false, reason: `${dst} n'est pas dans le réseau de ${d.name} (${networkOf(h.ip, h.mask)}/${maskToPrefix(h.mask)}) et aucune passerelle par défaut n'est configurée.` };
    if (!inSubnet(h.gateway, h.ip, h.mask)) return { ok: false, reason: `La passerelle ${h.gateway} de ${d.name} n'est pas dans son propre réseau (${networkOf(h.ip, h.mask)}/${maskToPrefix(h.mask)}).` };
    return { ok: true, ifc: i, nextHop: h.gateway };
  }
  const table = routingTable(p, d);
  const candidates = table.filter((r) => r.type !== 'L' && inSubnet(dst, r.network, r.mask)).sort((a, b) => b.prefix - a.prefix || (a.type === 'C' ? -1 : 1));
  for (const r of candidates) {
    if (r.type === 'C' && r.ifc) return { ok: true, ifc: r.ifc, nextHop: dst };
    if (r.type === 'S') {
      if (r.exitIf) {
        const ifc = l3Interfaces(p, d).find((i) => i.name === r.exitIf && i.up);
        if (ifc) return { ok: true, ifc, nextHop: r.nextHop ?? dst };
        continue;
      }
      if (r.nextHop && depth < 4) {
        const sub = routeLookup(p, d, r.nextHop, depth + 1);
        if (sub.ok) return { ok: true, ifc: sub.ifc, nextHop: sub.nextHop === r.nextHop ? r.nextHop : sub.nextHop };
      }
    }
  }
  // Switch de niveau 2 Cisco : passerelle de gestion
  if (isSwitch(d) && !isRoutingDevice(d) && d.config.defaultGateway) {
    const ifc = l3Interfaces(p, d).find((i) => i.up && inSubnet(d.config.defaultGateway!, i.ip, i.mask));
    if (ifc) return { ok: true, ifc, nextHop: d.config.defaultGateway };
  }
  const hasIp = l3Interfaces(p, d).some((i) => i.up);
  if (!hasIp) return { ok: false, reason: `${d.name} n'a aucune interface IP active.` };
  return { ok: false, reason: isRouter(d) ? `${d.name} n'a aucune route vers ${dst} (vérifiez « show ip route »).` : `${d.name} ne connaît pas de chemin vers ${dst} (pas de passerelle par défaut).` };
}

// ---------- ACL ----------
export function aclPermits(d: Device, aclId: string | undefined, src: string, dst: string): { ok: boolean; acl?: Acl } {
  if (!aclId) return { ok: true };
  const acl = d.config.acls?.find((a) => a.id === aclId);
  if (!acl) return { ok: true }; // ACL inexistante
  // Defense in depth if an invalid object is encountered outside the validated import path.
  if (!Array.isArray(acl.entries)) return { ok: false };
  if (acl.entries.length === 0) return { ok: true };
  for (const e of acl.entries) {
    const srcOk = wildcardMatch(src, e.src, e.srcWc);
    const dstOk = acl.type === 'standard' || wildcardMatch(dst, e.dst!, e.dstWc!);
    if (srcOk && dstOk) return { ok: e.action === 'permit', acl };
  }
  return { ok: false, acl }; // deny implicite
}

// ---------- ARP ----------
type ArpRes = { ok: true; target: L3If; path: Hop[] } | { ok: false; reason: string };
export function arpResolve(p: Project, d: Device, ifc: L3If, nextHop: string, events: SimEvent[], rt?: Runtime, kind: PacketKind = 'ARP'): ArpRes {
  const reach = l2Reach(p, d, ifc.attach, ifc.name);
  const cands = [...reach.endpoints.values()].filter((e) => e.ifc.ip === nextHop && e.ifc.up);
  if (!cands.length) {
    const owner = p.devices.flatMap((x) => l3Interfaces(p, x)).find((i) => i.ip === nextHop);
    let reason = `Aucune réponse ARP pour ${nextHop}. `;
    reason += owner ? `${owner.dev.name} possède cette adresse mais n'est pas joignable au niveau 2 depuis ${d.name}.` : `Aucun équipement du projet ne possède l'adresse ${nextHop}.`;
    if (owner && !owner.up) reason += ` L'interface ${owner.name} de ${owner.dev.name} est inactive.`;
    if (reach.notes.length) reason += ' Indices : ' + reach.notes.slice(0, 4).join(' ');
    events.push({ kind, at: d.id, text: `ARP Request (broadcast) : « Qui a ${nextHop} ? » — aucune réponse.`, status: 'fail', layer: 'Couche 2' });
    return { ok: false, reason };
  }
  if (cands.length > 1) {
    const names = cands.map(c => c.ifc.dev.name).join(', ');
    const reason = `Conflit d’adresse IP : ${nextHop} est utilisée par plusieurs interfaces joignables (${names}). Corrigez les adresses avant de poursuivre.`;
    events.push({ kind, at: d.id, text: reason, status: 'fail', layer: 'Couche 2' });
    return { ok: false, reason };
  }
  if (reach.loop) events.push({ kind, at: d.id, text: 'Attention : boucle de niveau 2 détectée (STP non simulé).', status: 'info' });
  const t = cands[0];
  const known = rt?.arp[d.id]?.some((a) => a.ip === nextHop);
  if (!known) {
    t.path.forEach((h, i) => events.push({ kind: 'ARP', at: h.to, hop: h, text: i === 0 ? `ARP Request (broadcast${h.tag ? `, VLAN ${h.tag}` : ''}) : « Qui a ${nextHop} ? Répondre à ${ifc.ip} »` : `Le switch diffuse la requête ARP sur les ports du même VLAN.`, status: 'info', layer: 'Couche 2' }));
    reverseHops(t.path).forEach((h, i) => events.push({ kind: 'ARP', at: h.to, hop: h, text: i === 0 ? `ARP Reply (unicast) : « ${nextHop} est à l'adresse MAC ${t.ifc.mac.replace(/(.{4})(.{4})(.{4})/, '$1.$2.$3')} »` : 'Le switch transmet la réponse ARP grâce à sa table MAC.', status: 'info', layer: 'Couche 2' }));
  }
  learnArp(rt, d.id, { ip: nextHop, mac: t.ifc.mac, ifName: ifc.name });
  learnArp(rt, t.ifc.dev.id, { ip: ifc.ip, mac: ifc.mac, ifName: t.ifc.name });
  learnPath(p, rt, t.path, ifc.mac);
  learnPath(p, rt, reverseHops(t.path), t.ifc.mac);
  return { ok: true, target: t.ifc, path: t.path };
}

function learnPath(p: Project, rt: Runtime | undefined, path: Hop[], srcMac: string) {
  if (!rt) return;
  for (const h of path) {
    const d = getDevice(p, h.to);
    if (!d || !isSwitch(d)) continue;
    const port = getPort(d, h.toPort);
    if (!port) continue;
    const vlan = h.tag ?? (port.mode === 'trunk' ? port.nativeVlan ?? 1 : port.accessVlan ?? 1);
    learnMac(rt, d.id, { mac: srcMac, port: port.name, vlan });
  }
}

// ---------- Acheminement d'un paquet IP ----------
export function deliver(p: Project, origin: Device, pkt: Packet, events: SimEvent[], rt?: Runtime): DeliverResult {
  let cur = origin;
  let ingress: L3If | null = null;
  const routers: RouterHop[] = [];
  const label = pkt.type === 'echo-request' ? 'ICMP Echo Request' : 'ICMP Echo Reply';
  const fail = (kind: Fail['kind'], reason: string, replyFrom?: string): Fail => {
    events.push({ kind: 'ICMP', at: cur.id, text: reason, status: 'fail', layer: 'Couche 3' });
    return { ok: false, kind, reason, at: cur, replyFrom, routers };
  };
  if (origin.poweredOn === false) return fail('timeout', `${origin.name} est éteint.`);
  // Adresse locale ?
  const local = l3Interfaces(p, origin).find((i) => i.ip === pkt.dst);
  if (local) { if (!pkt.src) pkt.src = local.ip; return { ok: true, dev: origin, ifc: local, ttl: pkt.ttl, routers, src: pkt.src }; }

  for (let guard = 0; guard < 40; guard++) {
    if (ingress) {
      if (isHost(cur) || (isSwitch(cur) && !isRoutingDevice(cur))) {
        if (ingress.ip === pkt.dst) { events.push({ kind: 'ICMP', at: cur.id, text: `${cur.name} reçoit le paquet qui lui est destiné (${pkt.dst}).`, status: 'ok', layer: 'Couche 3' }); return { ok: true, dev: cur, ifc: ingress, ttl: pkt.ttl, routers, src: pkt.src }; }
        return fail('timeout', `${cur.name} reçoit un paquet pour ${pkt.dst} mais ne fait pas de routage : paquet ignoré.`);
      }
      // Routeur
      const inAcl = aclPermits(cur, ingress.aclIn, pkt.src, pkt.dst);
      if (!inAcl.ok) return fail('unreachable', `L'ACL ${ingress.aclIn} appliquée en entrée sur ${ingress.name} de ${cur.name} bloque le paquet ${pkt.src} → ${pkt.dst}.`, ingress.ip);
      const own = l3Interfaces(p, cur).find((i) => i.ip === pkt.dst && i.up);
      if (own) { events.push({ kind: 'ICMP', at: cur.id, text: `${cur.name} reçoit le paquet destiné à son interface ${own.name} (${own.ip}).`, status: 'ok', layer: 'Couche 3' }); return { ok: true, dev: cur, ifc: own, ttl: pkt.ttl, routers, src: pkt.src }; }
      pkt.ttl -= 1;
      routers.push({ dev: cur, ip: ingress.ip });
      if (pkt.ttl <= 0) return fail('ttl', `TTL expiré sur ${cur.name} (Time Exceeded).`, ingress.ip);
    }
    const r = routeLookup(p, cur, pkt.dst);
    if (!r.ok) return fail(ingress ? 'unreachable' : 'timeout', r.reason, ingress?.ip);
    if (!pkt.src) pkt.src = r.ifc.ip;
    if (ingress && isRoutingDevice(cur)) {
      const outAcl = aclPermits(cur, r.ifc.aclOut, pkt.src, pkt.dst);
      if (!outAcl.ok) return fail('unreachable', `L'ACL ${r.ifc.aclOut} appliquée en sortie sur ${r.ifc.name} de ${cur.name} bloque le paquet ${pkt.src} → ${pkt.dst}.`, ingress.ip);
    }
    events.push({ kind: 'ICMP', at: cur.id, text: ingress
      ? `${cur.name} route le paquet vers ${pkt.dst} : sortie ${r.ifc.name}, prochain saut ${r.nextHop}${r.nextHop === pkt.dst ? ' (réseau directement connecté)' : ''}. TTL=${pkt.ttl}.`
      : `${cur.name} prépare un ${label} ${pkt.src} → ${pkt.dst}${r.nextHop !== pkt.dst ? ` via la passerelle ${r.nextHop}` : ' (même réseau)'}.`, status: 'info', layer: 'Couche 3' });
    const arp = arpResolve(p, cur, r.ifc, r.nextHop, events, rt);
    if (!arp.ok) return fail(ingress ? 'unreachable' : 'timeout', arp.reason, ingress?.ip);
    arp.path.forEach((h) => events.push({ kind: 'ICMP', at: h.to, hop: h, text: `${label} ${pkt.src} → ${pkt.dst}${h.tag ? ` (trame étiquetée VLAN ${h.tag})` : ''}`, status: 'info', layer: 'Couche 3' }));
    ingress = arp.target;
    cur = arp.target.dev;
  }
  return fail('timeout', 'Boucle de routage : le paquet tourne entre les routeurs.');
}

// ---------- Ping ----------
export interface PingResult {
  success: boolean;
  outcome: 'reply' | 'timeout' | 'unreachable' | 'ttl';
  events: SimEvent[];
  reason?: string;
  replyFrom?: string;
  ttl?: number;
  src?: string;
}

export function ping(p: Project, srcId: string, dst: string, rt?: Runtime, ttl?: number): PingResult {
  const events: SimEvent[] = [];
  const src = getDevice(p, srcId);
  if (!src) return { success: false, outcome: 'timeout', events, reason: 'Équipement source introuvable.' };
  if (!isIp(dst)) return { success: false, outcome: 'timeout', events, reason: `Adresse invalide : ${dst}` };
  events.push({ kind: 'ICMP', at: src.id, text: `${src.name} lance un ping vers ${dst}.`, status: 'info' });
  const req = deliver(p, src, { src: '', dst, ttl: ttl ?? initialTtl(src), type: 'echo-request' }, events, rt);
  if (!req.ok) {
    return { success: false, outcome: req.kind, events, reason: req.reason, replyFrom: req.replyFrom };
  }
  if (req.dev.id === src.id) {
    events.push({ kind: 'ICMP', at: src.id, text: 'Réponse locale (adresse de l’équipement lui-même).', status: 'ok' });
    return { success: true, outcome: 'reply', events, replyFrom: dst, ttl: initialTtl(src), src: req.src };
  }
  const rep = deliver(p, req.dev, { src: dst, dst: req.src, ttl: initialTtl(req.dev), type: 'echo-reply' }, events, rt);
  if (!rep.ok) {
    const reason = `La requête est arrivée à ${req.dev.name}, mais la réponse ne peut pas revenir : ${rep.reason}`;
    events.push({ kind: 'ICMP', at: rep.at.id, text: reason, status: 'fail' });
    return { success: false, outcome: 'timeout', events, reason };
  }
  events.push({ kind: 'ICMP', at: src.id, text: `${src.name} reçoit la réponse de ${dst} : le ping réussit.`, status: 'ok' });
  return { success: true, outcome: 'reply', events, replyFrom: dst, ttl: rep.ttl, src: req.src };
}

export interface TraceHop { ip: string | null; name?: string; final?: boolean }
export function traceroute(p: Project, srcId: string, dst: string, rt?: Runtime, max = 30): { hops: TraceHop[]; reason?: string } {
  const hops: TraceHop[] = [];
  for (let t = 1; t <= max; t++) {
    const r = ping(p, srcId, dst, rt, t);
    if (r.success) { hops.push({ ip: dst, final: true }); return { hops }; }
    if (r.outcome === 'ttl' && r.replyFrom) { hops.push({ ip: r.replyFrom }); continue; }
    if (r.outcome === 'unreachable' && r.replyFrom) { hops.push({ ip: r.replyFrom, final: true }); return { hops, reason: r.reason }; }
    hops.push({ ip: null });
    return { hops, reason: r.reason };
  }
  return { hops };
}

export function pingable(p: Project, a: string, b: string): boolean {
  const da = p.devices.find((d) => d.name === a);
  const db = p.devices.find((d) => d.name === b);
  if (!da || !db) return false;
  const target = l3Interfaces(p, db)[0];
  if (!target || !target.ip) return false;
  return ping(structuredClone(p), da.id, target.ip).success;
}
export { ifKey, parseIp };
