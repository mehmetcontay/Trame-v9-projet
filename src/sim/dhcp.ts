// DHCP : découverte du serveur par diffusion de niveau 2, attribution d'un bail réel.
import type { Project, Device, DhcpService } from '../model/types';
import { getDevice } from '../model/project';
import { inSubnet, intToIp, parseIp, networkInt, broadcastInt, maskToPrefix, isIp, isMask, isUsableHost } from './ip';
import { l2Reach, reverseHops } from './l2';
import { L3If, l3Interfaces, portUp, isRouter, kindOf } from './topology';
import type { SimEvent } from './engine';

export interface DhcpResult { ok: boolean; message: string; events: SimEvent[]; server?: string; notes?: string[] }

/** Validation du service sans relais : le pool doit appartenir au réseau de l'interface du serveur. */
export function dhcpServiceProblem(s: DhcpService, interfaceIp: string, interfaceMask: string): string | null {
  if (!isIp(interfaceIp) || !isMask(interfaceMask)) return 'Configurez d’abord l’adresse et le masque du serveur.';
  if (!isIp(s.poolStart) || !isMask(s.mask)) return 'Indiquez une première adresse et un masque de pool valides.';
  if (!isUsableHost(s.poolStart, s.mask)) return 'La première adresse du pool est une adresse de réseau ou de diffusion.';
  if (!inSubnet(s.poolStart, interfaceIp, interfaceMask) || !inSubnet(interfaceIp, s.poolStart, s.mask)) return 'Le pool doit être dans le réseau de l’interface du serveur (sans relais DHCP).';
  if (!Number.isInteger(s.maxUsers) || s.maxUsers < 1 || s.maxUsers > 1000) return 'Le nombre de clients doit être compris entre 1 et 1000.';
  if (s.gateway && (!isIp(s.gateway) || !isUsableHost(s.gateway, s.mask) || !inSubnet(s.gateway, s.poolStart, s.mask))) return 'La passerelle du pool doit être une adresse valide de ce réseau.';
  if (s.dns && !isIp(s.dns)) return 'L’adresse DNS distribuée est invalide.';
  return null;
}

function serverCanServe(d: Device, ifc: L3If): boolean {
  if (kindOf(d) === 'server') return !!d.config.dhcpService?.enabled && !!ifc.ip;
  if (isRouter(d)) return !!d.config.dhcpPools?.some((pl) => pl.network && pl.mask && inSubnet(ifc.ip, pl.network, pl.mask));
  return false;
}

function usedBy(server: Device, ip: string, mac: string): boolean {
  return !!server.config.leases?.some((l) => l.ip === ip && l.mac !== mac);
}

function allocate(p: Project, server: Device, ifc: L3If, client: Device): { ip: string; mask: string; gw: string; dns: string } | null {
  const mac = client.ports[0].mac;
  const existing = server.config.leases?.find((l) => l.mac === mac);
  const ownIps = new Set(l3Interfaces(p, server).map((i) => i.ip));
  if (kindOf(server) === 'server') {
    const s = server.config.dhcpService!;
    if (dhcpServiceProblem(s, ifc.ip, ifc.mask)) return null;
    const start = parseIp(s.poolStart)!;
    const oldAddress = existing ? parseIp(existing.ip) : null;
    if (existing && oldAddress !== null && oldAddress >= start && oldAddress < start + s.maxUsers &&
        inSubnet(existing.ip, s.poolStart, s.mask) && isUsableHost(existing.ip, s.mask) &&
        !ownIps.has(existing.ip) && existing.ip !== s.gateway && !usedBy(server, existing.ip, mac)) {
      return { ip: existing.ip, mask: s.mask, gw: s.gateway, dns: s.dns };
    }
    for (let i = 0; i < s.maxUsers; i++) {
      const ip = intToIp(start + i);
      if (!inSubnet(ip, s.poolStart, s.mask) || (start + i) >= broadcastInt(s.poolStart, s.mask)) break;
      if (!isUsableHost(ip, s.mask) || ownIps.has(ip) || ip === s.gateway || usedBy(server, ip, mac)) continue;
      return { ip, mask: s.mask, gw: s.gateway, dns: s.dns };
    }
    return null;
  }
  const pool = server.config.dhcpPools!.find((pl) => pl.network && pl.mask && inSubnet(ifc.ip, pl.network, pl.mask))!;
  const excluded = (ip: string) => (server.config.dhcpExcluded ?? []).some((r) => {
    const a = parseIp(ip)!, s = parseIp(r.start)!, e = parseIp(r.end || r.start)!;
    return a >= s && a <= e;
  });
  if (existing && inSubnet(existing.ip, pool.network!, pool.mask!) && !excluded(existing.ip)) return { ip: existing.ip, mask: pool.mask!, gw: pool.defaultRouter ?? '', dns: pool.dns ?? '' };
  const net = networkInt(pool.network!, pool.mask!), bc = broadcastInt(pool.network!, pool.mask!);
  for (let a = net + 1; a < bc; a++) {
    const ip = intToIp(a);
    if (ownIps.has(ip) || excluded(ip) || usedBy(server, ip, mac) || ip === pool.defaultRouter) continue;
    return { ip, mask: pool.mask!, gw: pool.defaultRouter ?? '', dns: pool.dns ?? '' };
  }
  return null;
}

/** Demande DHCP complète (DISCOVER/OFFER/REQUEST/ACK). Modifie le projet passé (brouillon). */
export function dhcpRenew(p: Project, hostId: string): DhcpResult {
  const events: SimEvent[] = [];
  const host = getDevice(p, hostId);
  if (!host || !host.config.host) return { ok: false, message: 'Équipement invalide', events };
  if (host.poweredOn === false) return { ok: false, message: `${host.name} est éteint.`, events };
  const h = host.config.host;
  const port = host.ports[0];
  h.mode = 'dhcp';
  if (!portUp(p, host, port.name)) {
    h.ip = ''; h.mask = ''; h.gateway = ''; h.dns = ''; h.dhcpServer = undefined;
    return { ok: false, message: 'Échec DHCP : la carte réseau est déconnectée (aucun câble ou port désactivé).', events };
  }
  const reach = l2Reach(p, host, { type: 'port', port: port.name, vlan: null }, port.name);
  const servers = [...reach.endpoints.values()].filter((e) => e.ifc.up && serverCanServe(e.ifc.dev, e.ifc)).sort((a, b) => a.path.length - b.path.length);
  for (const s of servers) {
    const lease = allocate(p, s.ifc.dev, s.ifc, host);
    if (!lease) continue;
    s.path.forEach((hp, i) => events.push({ kind: 'DHCP', at: hp.to, hop: hp, text: i === 0 ? 'DHCP Discover (broadcast 255.255.255.255) : le client cherche un serveur.' : 'Le switch diffuse le Discover dans le VLAN.', status: 'info', layer: 'Couche 7 / 2' }));
    reverseHops(s.path).forEach((hp, i) => events.push({ kind: 'DHCP', at: hp.to, hop: hp, text: i === 0 ? `DHCP Offer : ${s.ifc.dev.name} propose ${lease.ip}.` : 'Transmission de l’offre DHCP.', status: 'info', layer: 'Couche 7 / 2' }));
    s.path.forEach((hp, i) => events.push({ kind: 'DHCP', at: hp.to, hop: hp, text: i === 0 ? `DHCP Request : le client demande ${lease.ip}.` : 'Transmission de la requête DHCP.', status: 'info' }));
    reverseHops(s.path).forEach((hp, i) => events.push({ kind: 'DHCP', at: hp.to, hop: hp, text: i === 0 ? 'DHCP Ack : bail confirmé.' : 'Transmission de l’accusé DHCP.', status: 'info' }));
    const srv = s.ifc.dev;
    srv.config.leases = (srv.config.leases ?? []).filter((l) => l.mac !== port.mac);
    srv.config.leases.push({ ip: lease.ip, mac: port.mac, clientId: host.id, clientName: host.name });
    h.ip = lease.ip; h.mask = lease.mask; h.gateway = lease.gw; h.dns = lease.dns; h.dhcpServer = s.ifc.ip;
    events.push({ kind: 'DHCP', at: host.id, text: `${host.name} obtient ${lease.ip}/${maskToPrefix(lease.mask)}${lease.gw ? `, passerelle ${lease.gw}` : ''}.`, status: 'ok' });
    return { ok: true, message: `Adresse obtenue : ${lease.ip}`, events, server: s.ifc.ip };
  }
  // Échec : APIPA comme sous Windows
  const rnd = () => 1 + Math.floor(Math.random() * 253);
  h.ip = `169.254.${rnd()}.${rnd()}`; h.mask = '255.255.0.0'; h.gateway = ''; h.dns = ''; h.dhcpServer = undefined;
  const notes = reach.notes.slice(0, 4);
  const why = servers.length ? 'le pool du serveur est épuisé ou mal configuré' : 'aucun serveur DHCP joignable dans ce domaine de diffusion (VLAN)';
  events.push({ kind: 'DHCP', at: host.id, text: `DHCP Discover sans réponse : ${why}.`, status: 'fail' });
  return { ok: false, message: `Échec DHCP : ${why}. Adresse APIPA ${h.ip} attribuée.`, events, notes };
}

export function dhcpRelease(p: Project, hostId: string) {
  const host = getDevice(p, hostId);
  if (!host?.config.host) return;
  const mac = host.ports[0].mac;
  for (const d of p.devices) if (d.config.leases) d.config.leases = d.config.leases.filter((l) => l.mac !== mac);
  Object.assign(host.config.host, { ip: '', mask: '', gateway: '', dns: '', dhcpServer: undefined });
}
