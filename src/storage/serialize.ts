// Sérialisation / validation des projets (format de fichier .trame.json).
import type { Project } from '../model/types';
import { findModel } from '../devices/catalog';
import { connect } from '../model/project';
import { isIp } from '../sim/ip';

export const FILE_EXT = '.trame.json';

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export class ProjectFormatError extends Error {}

export function parseProject(text: string): Project {
  const fail = (message: string): never => { throw new ProjectFormatError(message); };
  if (text.length > 5_000_000) fail('Fichier trop volumineux (limite : 5 Mo).');
  let data: any;
  try { data = JSON.parse(text); } catch { return fail('Le fichier n’est pas un JSON valide.'); }
  const obj = (x: any) => x && typeof x === 'object' && !Array.isArray(x);
  const textValue = (x: any) => typeof x === 'string';
  const num = (x: any) => typeof x === 'number' && Number.isFinite(x);
  const optionalText = (x: any) => x === undefined || textValue(x);
  if (!obj(data) || data.format !== 'trame-project') fail('Ce fichier n’est pas un projet Trame.');
  if (data.version !== 1) fail(`Version de projet non prise en charge : ${data.version}.`);
  if (!textValue(data.id) || !textValue(data.name) || !num(data.createdAt) || !num(data.updatedAt)) fail('Informations du projet invalides.');
  if (!Array.isArray(data.devices) || !Array.isArray(data.links) || data.devices.length > 1000 || data.links.length > 4000) fail('Projet incomplet ou trop volumineux.');
  data.notes ??= [];
  if (!Array.isArray(data.notes) || data.notes.length > 1000) fail('Notes invalides.');
  const ids = new Set<string>();
  const arrays = ['vlans', 'svis', 'subifs', 'routes', 'dhcpPools', 'dhcpExcluded', 'leases', 'acls'];
  for (const d of data.devices) {
    if (!obj(d) || !textValue(d.id) || !d.id || ids.has(d.id) || !textValue(d.name) || !num(d.x) || !num(d.y)) fail('Équipement invalide ou identifiant en double.');
    ids.add(d.id);
    if (d.poweredOn !== undefined && typeof d.poweredOn !== 'boolean') fail(`État d’alimentation invalide : ${d.name}.`);
    const m = findModel(d.modelId);
    if (!m || !m.available) fail(`Modèle inconnu ou non pris en charge : ${d.modelId}.`);
    const validateConfig = (config: any, ports: any) => {
      if (!obj(config) || !textValue(config.hostname) || !Array.isArray(ports) || ports.length !== m!.ports.reduce((n, g) => n + g.to - g.from + 1, 0)) fail(`Configuration ou ports invalides : ${d.name}.`);
      const expected = new Set(m!.ports.flatMap(g => Array.from({length:g.to-g.from+1}, (_,i) => `${g.full}${g.from+i}`)));
      for (const pt of ports) {
        if (!obj(pt) || !textValue(pt.name) || !expected.delete(pt.name) || !textValue(pt.short) || !textValue(pt.speed) || !/^[0-9a-f]{12}$/i.test(pt.mac) || typeof pt.adminUp !== 'boolean') fail(`Port invalide : ${d.name}.`);
        if (pt.mode !== undefined && !['access','trunk'].includes(pt.mode)) fail(`Mode de port invalide : ${d.name}.`);
        if (!optionalText(pt.ip) || !optionalText(pt.mask) || !optionalText(pt.aclIn) || !optionalText(pt.aclOut) ||
            (pt.accessVlan !== undefined && !num(pt.accessVlan)) ||
            (pt.nativeVlan !== undefined && pt.nativeVlan !== null && !num(pt.nativeVlan)) ||
            (pt.trunkAllowed !== undefined && pt.trunkAllowed !== 'all' &&
              (!Array.isArray(pt.trunkAllowed) || pt.trunkAllowed.some((v: any) => !num(v))))) fail(`Paramètres de port invalides : ${d.name}.`);
      }
      for (const key of arrays) if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some((x: any) => !obj(x)))) fail(`Configuration ${key} invalide : ${d.name}.`);
      if ((config.acls ?? []).some((a: any) =>
        !textValue(a.id) || !['standard', 'extended'].includes(a.type) || !Array.isArray(a.entries) ||
        a.entries.some((e: any) => !obj(e) || !['permit', 'deny'].includes(e.action) ||
          !(e.protocol === null || e.protocol === 'ip' || e.protocol === 'icmp') ||
          !textValue(e.src) || !textValue(e.srcWc) || !isIp(e.src) || !isIp(e.srcWc) ||
          (a.type === 'extended' && (!textValue(e.dst) || !textValue(e.dstWc) || !isIp(e.dst) || !isIp(e.dstWc)))))) {
        fail(`ACL invalide : ${d.name}.`);
      }
      if ((config.subifs ?? []).some((s: any) => !textValue(s.name) || !textValue(s.parent) || typeof s.adminUp !== 'boolean' ||
          (s.vlan !== undefined && !num(s.vlan)) || !optionalText(s.ip) || !optionalText(s.mask) || !optionalText(s.aclIn) || !optionalText(s.aclOut)) ||
          (config.routes ?? []).some((r: any) => !textValue(r.network) || !textValue(r.mask) || !optionalText(r.nextHop) || !optionalText(r.exitIf)) ||
          (config.dhcpPools ?? []).some((p: any) => !textValue(p.name) || !optionalText(p.network) || !optionalText(p.mask) || !optionalText(p.defaultRouter) || !optionalText(p.dns)) ||
          (config.dhcpExcluded ?? []).some((r: any) => !textValue(r.start) || !textValue(r.end)) ||
          (config.leases ?? []).some((l: any) => !textValue(l.ip) || !textValue(l.mac) || !textValue(l.clientId) || !textValue(l.clientName))) {
        fail(`Configuration réseau invalide : ${d.name}.`);
      }
      if (config.printJobs !== undefined && (!Array.isArray(config.printJobs) || config.printJobs.length > 50 || config.printJobs.some((j: any) => !obj(j) || !textValue(j.from) || !textValue(j.text) || j.text.length > 500 || !num(j.at)))) fail(`File d’impression invalide : ${d.name}.`);
      if (m!.os === 'host' && (!obj(config.host) || !['static','dhcp'].includes(config.host.mode) || !['ip','mask','gateway','dns'].every(k => textValue(config.host[k])))) fail(`Configuration IP invalide : ${d.name}.`);
      if (m!.kind === 'server' && (!obj(config.dhcpService) || typeof config.dhcpService.enabled !== 'boolean' || !num(config.dhcpService.maxUsers) || !['poolStart','mask','gateway','dns'].every(k => textValue(config.dhcpService[k])))) fail(`Service DHCP invalide : ${d.name}.`);
      if ((m!.kind === 'switch' || m!.kind === 'ap') && !Array.isArray(config.vlans)) fail(`VLAN manquants : ${d.name}.`);
      if ((config.vlans ?? []).some((v: any) => !num(v.id) || !textValue(v.name)) ||
          (config.svis ?? []).some((v: any) => !num(v.vlan) || typeof v.adminUp !== 'boolean' || !optionalText(v.ip) || !optionalText(v.mask))) fail(`VLAN invalides : ${d.name}.`);
    };
    validateConfig(d.config, d.ports);
    if (d.startup != null) { if (!obj(d.startup)) fail(`Configuration enregistrée invalide : ${d.name}.`); validateConfig(d.startup.config, d.startup.ports); }
  }
  const noteIds = new Set<string>();
  for (const n of data.notes) { if (!obj(n) || !textValue(n.id) || noteIds.has(n.id) || !textValue(n.text) || !num(n.x) || !num(n.y)) fail('Note invalide ou identifiant en double.'); noteIds.add(n.id); }
  if (data.exerciseId != null && !textValue(data.exerciseId)) fail('Référence d’exercice invalide.');
  const seenLinks = new Set<string>();
  const validation = { ...data, links: [] } as Project;
  for (const l of data.links) {
    if (!obj(l) || !textValue(l.id) || !l.id || seenLinks.has(l.id) || !obj(l.a) || !obj(l.b) || !textValue(l.a.device) || !textValue(l.a.port) || !textValue(l.b.device) || !textValue(l.b.port)) fail('Liaison invalide ou identifiant en double.');
    seenLinks.add(l.id);
    try { connect(validation, l.a, l.b); } catch { fail('Liaison impossible : port absent, occupé ou incompatible.'); }
  }
  return data as Project;
}

/** Vérifie si un fichier ressemble à un projet Cisco Packet Tracer (.pkt/.pka). */
export function isPacketTracerFile(name: string): boolean { return /\.(pkt|pka|pkz)$/i.test(name); }
