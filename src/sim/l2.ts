// Moteur de niveau 2 : propagation des trames Ethernet (VLAN, trunks 802.1Q, états des ports).
import type { Project, Device } from '../model/types';
import { findLink, otherEnd, getDevice, getPort } from '../model/project';
import { Attach, L3If, isSwitch, isHost, isRouter, l3Interfaces, vlanExists, portCarriesVlan, osOf, sviUp } from './topology';

export interface Hop {
  linkId: string;
  from: string; to: string;          // ids d'équipements
  fromPort: string; toPort: string;
  tag: number | null;                // étiquette 802.1Q sur le câble
  vlanAtTo?: number;                 // VLAN dans le switch de destination
}
export interface Endpoint { ifc: L3If; path: Hop[] }
export interface Reach { endpoints: Map<string, Endpoint>; notes: string[]; loop: boolean }

export const ifKey = (i: { dev: Device; name: string }) => `${i.dev.id}|${i.name}`;

/**
 * Diffuse une trame (broadcast) depuis une interface et retourne toutes les interfaces de niveau 3
 * atteintes, avec le chemin le plus court. Les raisons d'abandon rencontrées sont conservées pour le diagnostic.
 */
export function l2Reach(p: Project, src: Device, attach: Attach, srcName?: string): Reach {
  const endpoints = new Map<string, Endpoint>();
  const notes = new Set<string>();
  const visited = new Set<string>();
  let loop = false;
  type Task = { t: 'emit'; dev: Device; port: string; tag: number | null; path: Hop[] } | { t: 'flood'; dev: Device; vlan: number; ingress: string | null; path: Hop[] };
  const q: Task[] = [];
  const srcKey = srcName ? `${src.id}|${srcName}` : '';

  if (attach.type === 'port') q.push({ t: 'emit', dev: src, port: attach.port, tag: attach.vlan, path: [] });
  else { visited.add(`${src.id}|${attach.vlan}`); q.push({ t: 'flood', dev: src, vlan: attach.vlan, ingress: null, path: [] }); }

  const addEp = (ifc: L3If, path: Hop[]) => {
    const k = ifKey(ifc);
    if (k === srcKey || endpoints.has(k)) return;
    endpoints.set(k, { ifc, path });
  };

  while (q.length) {
    const task = q.shift()!;
    if (task.t === 'emit') {
      const { dev, port: portName, tag, path } = task;
      const port = getPort(dev, portName);
      if (!port) continue;
      if (dev.poweredOn === false) { notes.add(`${dev.name} est éteint.`); continue; }
      if (!port.adminUp) { notes.add(`Le port ${port.short} de ${dev.name} est désactivé (shutdown).`); continue; }
      const link = findLink(p, dev.id, portName);
      if (!link) { notes.add(`Le port ${port.short} de ${dev.name} n'est relié à aucun câble.`); continue; }
      const o = otherEnd(link, dev.id, portName);
      const pd = getDevice(p, o.device);
      const pp = pd && getPort(pd, o.port);
      if (!pd || !pp) continue;
      if (pd.poweredOn === false) { notes.add(`${pd.name} est éteint.`); continue; }
      if (!pp.adminUp) { notes.add(`Le port ${pp.short} de ${pd.name} est désactivé (shutdown) : le lien est inactif.`); continue; }
      const hop: Hop = { linkId: link.id, from: dev.id, to: pd.id, fromPort: portName, toPort: pp.name, tag };
      const np = [...path, hop];
      if (isSwitch(pd)) {
        let vlan: number;
        if (pp.mode === 'trunk') {
          if (tag === null) {
            if (pp.nativeVlan === null || pp.nativeVlan === undefined) { notes.add(`${pd.name} ${pp.short} : trame non étiquetée reçue mais aucun VLAN natif (native vlan none).`); continue; }
            vlan = pp.nativeVlan;
          } else vlan = tag;
          if (!portCarriesVlan(pp, vlan, osOf(pd))) { notes.add(`${pd.name} ${pp.short} (trunk) : le VLAN ${vlan} n'est pas autorisé sur ce trunk.`); continue; }
        } else {
          if (tag !== null) { notes.add(`${pd.name} ${pp.short} est un port d'accès : la trame étiquetée VLAN ${tag} venant de ${dev.name} ${port.short} est rejetée (l'autre côté est-il en trunk ?).`); continue; }
          vlan = pp.accessVlan ?? 1;
        }
        if (!vlanExists(pd, vlan)) { notes.add(`Le VLAN ${vlan} n'existe pas sur ${pd.name} : le port ${pp.short} ne transmet rien.`); continue; }
        hop.vlanAtTo = vlan;
        const key = `${pd.id}|${vlan}`;
        if (visited.has(key)) { loop = true; continue; }
        visited.add(key);
        q.push({ t: 'flood', dev: pd, vlan, ingress: pp.name, path: np });
      } else {
        const ifs = l3Interfaces(p, pd, true).filter((i) => i.attach.type === 'port' && i.attach.port === pp.name && i.attach.vlan === tag);
        if (!ifs.length) {
          if (tag !== null) notes.add(`${pd.name} ${pp.short} reçoit une trame étiquetée VLAN ${tag} mais n'a aucune sous-interface « encapsulation dot1Q ${tag} ».`);
          else if (isRouter(pd)) notes.add(`${pd.name} ${pp.short} reçoit une trame non étiquetée mais l'interface n'a pas d'adresse IP.`);
          continue;
        }
        for (const i of ifs) addEp(i, np);
        if (isHost(pd) && !ifs.some((i) => i.ip)) notes.add(`${pd.name} n'a pas d'adresse IP.`);
      }
    } else {
      const { dev, vlan, ingress, path } = task;
      const svi = dev.config.svis?.find((s) => s.vlan === vlan);
      if (svi && ingress !== null) {
        const ifc = l3Interfaces(p, dev, true).find((i) => i.attach.type === 'svi' && i.attach.vlan === vlan);
        if (ifc) addEp({ ...ifc, up: sviUp(p, dev, vlan) && !!ifc.ip }, path);
      }
      const os = osOf(dev);
      for (const port of dev.ports) {
        if (port.name === ingress) continue;
        if (!findLink(p, dev.id, port.name)) continue;
        if (!port.adminUp) { notes.add(`Le port ${port.short} de ${dev.name} est désactivé (shutdown).`); continue; }
        if (port.mode === 'trunk') {
          if (!portCarriesVlan(port, vlan, os)) { notes.add(`${dev.name} ${port.short} (trunk) : le VLAN ${vlan} n'est pas autorisé, la trame n'est pas transmise.`); continue; }
          const tag = port.nativeVlan === vlan ? null : vlan;
          q.push({ t: 'emit', dev, port: port.name, tag, path });
        } else {
          if ((port.accessVlan ?? 1) !== vlan) { notes.add(`${dev.name} ${port.short} est dans le VLAN ${port.accessVlan ?? 1} : la trame du VLAN ${vlan} n'y est pas transmise.`); continue; }
          q.push({ t: 'emit', dev, port: port.name, tag: null, path });
        }
      }
    }
  }
  return { endpoints, notes: [...notes], loop };
}

export function reverseHops(path: Hop[]): Hop[] {
  return [...path].reverse().map((h) => ({ linkId: h.linkId, from: h.to, to: h.from, fromPort: h.toPort, toPort: h.fromPort, tag: h.tag }));
}

