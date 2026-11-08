// Opérations sur le projet (topologie) — fonctions pures ou mutation d'un brouillon.
import type { Project, Device, Link, Port, LinkEnd } from './types';
import { uid, createDevice, nextName } from '../devices/factory';
import { getModel } from '../devices/catalog';

export function createProject(name = 'Projet sans titre'): Project {
  const now = Date.now();
  return { format: 'trame-project', version: 1, id: uid('prj'), name, devices: [], links: [], notes: [], createdAt: now, updatedAt: now, exerciseId: null };
}
export function getDevice(p: Project, id: string): Device | undefined { return p.devices.find((d) => d.id === id); }
export function deviceByName(p: Project, name: string): Device | undefined { return p.devices.find((d) => d.name === name); }
export function getPort(d: Device, name: string): Port | undefined { return d.ports.find((x) => x.name === name); }
export function findLink(p: Project, dev: string, port: string): Link | undefined {
  return p.links.find((l) => (l.a.device === dev && l.a.port === port) || (l.b.device === dev && l.b.port === port));
}
export function otherEnd(l: Link, dev: string, port: string): LinkEnd {
  return l.a.device === dev && l.a.port === port ? l.b : l.a;
}
export function addDevice(p: Project, modelId: string, x: number, y: number, name?: string): Device {
  const d = createDevice(modelId, name ?? nextName(p, getModel(modelId).namePrefix), x, y);
  p.devices.push(d);
  return d;
}
export function connect(p: Project, a: LinkEnd, b: LinkEnd): Link {
  if (a.device === b.device) throw new Error('Impossible de relier un équipement à lui-même.');
  for (const e of [a, b]) {
    const d = getDevice(p, e.device);
    if (!d || !getPort(d, e.port)) throw new Error(`Port introuvable : ${e.port}`);
    if (findLink(p, e.device, e.port)) throw new Error(`Le port ${e.port} de ${d.name} est déjà utilisé.`);
  }
  const da = getDevice(p, a.device)!, db = getDevice(p, b.device)!;
  const radio = (d: Device, port: string) => d.modelId === 'laptop' && port.startsWith('WiFi') ? 'wifi-client' : d.modelId === 'ap' && port.startsWith('Radio') ? 'wifi-base' : d.modelId === 'dect-phone' && port.startsWith('DECT') ? 'dect-client' : d.modelId === 'dect-base' && port.startsWith('DECT') ? 'dect-base' : 'ethernet';
  const x = radio(da, a.port), y = radio(db, b.port);
  const compatible = x === 'ethernet' && y === 'ethernet' || [x, y].includes('wifi-client') && [x, y].includes('wifi-base') || [x, y].includes('dect-client') && [x, y].includes('dect-base');
  if (!compatible) throw new Error('Ports incompatibles : Wi-Fi avec point d’accès, DECT avec base DECT, ou Ethernet avec Ethernet.');
  const l: Link = { id: uid('lnk'), a, b };
  p.links.push(l);
  return l;
}
export function removeDevice(p: Project, id: string) {
  p.devices = p.devices.filter((d) => d.id !== id);
  p.links = p.links.filter((l) => l.a.device !== id && l.b.device !== id);
}
export function removeLink(p: Project, id: string) { p.links = p.links.filter((l) => l.id !== id); }
export function freePorts(p: Project, d: Device): Port[] { return d.ports.filter((x) => !findLink(p, d.id, x.name)); }
