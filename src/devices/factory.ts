// Création d'équipements avec leur configuration d'usine.
import type { Device, Port, DeviceConfig, Project } from '../model/types';
import { getModel } from './catalog';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

const OUI: Record<string, string> = { Cisco: '0001c7', 'Allied Telesis': '0000cd', 'Générique': '00e0f7' };
export function randomMac(vendor = 'Générique'): string {
  let s = OUI[vendor] ?? '00e0f7';
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
export function macDotted(m: string): string { return `${m.slice(0, 4)}.${m.slice(4, 8)}.${m.slice(8, 12)}`; }
export function macDashed(m: string): string { return m.toUpperCase().match(/../g)!.join('-'); }

export function defaultConfig(modelId: string): DeviceConfig {
  const m = getModel(modelId);
  switch (m.os) {
    case 'host':
      return {
        hostname: m.namePrefix,
        host: { mode: 'static', ip: '', mask: '', gateway: '', dns: '' },
        ...(m.kind === 'server' ? { dhcpService: { enabled: false, poolStart: '192.168.1.100', mask: '255.255.255.0', maxUsers: 50, gateway: '', dns: '' } } : {}),
      };
    case 'filter':
      return { hostname: m.namePrefix, routes: [], acls: [] };
    case 'bridge':
      return { hostname: m.namePrefix, vlans: [{ id: 1, name: 'default' }], svis: [] };
    case 'ios-switch':
      return { hostname: 'Switch', vlans: [{ id: 1, name: 'default' }], svis: [{ vlan: 1, adminUp: false }] };
    case 'ios-router':
      return { hostname: 'Router', subifs: [], routes: [], dhcpPools: [], dhcpExcluded: [], leases: [], acls: [] };
    case 'awplus':
      if (m.kind === 'router') return { hostname: 'awplus', routes: [] };
      return { hostname: 'awplus', vlans: [{ id: 1, name: 'default' }], svis: [{ vlan: 1, adminUp: true }], routes: [] };
    default:
      return { hostname: m.namePrefix };
  }
}

export function defaultPorts(modelId: string): Port[] {
  const m = getModel(modelId);
  const ports: Port[] = [];
  for (const g of m.ports) {
    for (let i = g.from; i <= g.to; i++) {
      const isHost = m.os === 'host';
      const p: Port = {
        name: isHost ? `${g.full}${i}` : `${g.full}${i}`,
        short: `${g.short}${i}`,
        mac: randomMac(m.vendor), speed: g.speed,
        adminUp: m.kind !== 'router' && m.kind !== 'firewall',
      };
      if (m.kind === 'switch' || m.kind === 'ap') {
        if (m.os === 'awplus') p.mode = 'access';
        p.accessVlan = 1; p.nativeVlan = 1;
        p.trunkAllowed = m.os === 'awplus' ? [] : 'all';
      }
      ports.push(p);
    }
  }
  return ports;
}

export function nextName(project: Project, prefix: string): string {
  let i = 1;
  const names = new Set(project.devices.map((d) => d.name));
  while (names.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export function createDevice(modelId: string, name: string, x: number, y: number): Device {
  const m = getModel(modelId);
  if (!m.available) throw new Error(`${m.label} n'est pas encore simulé`);
  const config = defaultConfig(modelId);
  if (m.os === 'host') config.hostname = name;
  return { id: uid('dev'), modelId, name, x, y, ports: defaultPorts(modelId), config, startup: null };
}

/** Duplique un équipement (nouvelle identité, nouvelles MAC, pas de câbles). */
export function cloneDevice(d: Device, name: string): Device {
  const m = getModel(d.modelId);
  const c: Device = JSON.parse(JSON.stringify(d));
  c.id = uid('dev'); c.name = name; c.x += 40; c.y += 40;
  for (const p of c.ports) p.mac = randomMac(m.vendor);
  if (c.config.host) { c.config.host.ip = c.config.host.mode === 'dhcp' ? '' : c.config.host.ip; if (m.os === 'host') c.config.hostname = name; }
  c.config.leases = c.config.leases ? [] : undefined;
  return c;
}
