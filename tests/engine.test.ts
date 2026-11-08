import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addDevice, connect, getPort } from '../src/model/project';
import { ping } from '../src/sim/engine';
import { dhcpRenew } from '../src/sim/dhcp';

function lan() {
  const p = createProject();
  const sw = addDevice(p, 'cisco-2960', 0, 0, 'SW1');
  const a = addDevice(p, 'pc', 0, 0, 'PC1'), b = addDevice(p, 'pc', 0, 0, 'PC2');
  connect(p, { device: a.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  connect(p, { device: b.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/2' });
  Object.assign(a.config.host!, { ip: '192.168.1.10', mask: '255.255.255.0' });
  Object.assign(b.config.host!, { ip: '192.168.1.11', mask: '255.255.255.0' });
  return { p, sw, a, b };
}

test('deux PC correctement configurés communiquent via un switch', () => {
  const { p, a } = lan();
  const r = ping(p, a.id, '192.168.1.11');
  assert.equal(r.success, true);
  assert.ok(r.events.some((e) => e.kind === 'ARP' && e.hop), 'la résolution ARP est visible');
  assert.ok(r.events.some((e) => e.kind === 'ICMP' && e.hop), 'les paquets ICMP traversent les câbles');
});

test('échec si les PC ne sont pas dans le même réseau', () => {
  const { p, a, b } = lan();
  b.config.host!.ip = '192.168.2.11';
  const r = ping(p, a.id, '192.168.2.11');
  assert.equal(r.success, false);
  assert.match(r.reason!, /passerelle/);
});

test('échec si un port du switch est désactivé (shutdown)', () => {
  const { p, sw, a } = lan();
  getPort(sw, 'FastEthernet0/2')!.adminUp = false;
  const r = ping(p, a.id, '192.168.1.11');
  assert.equal(r.success, false);
  assert.match(r.reason!, /shutdown/);
});

test('échec si le câble est retiré', () => {
  const { p, a } = lan();
  p.links = p.links.slice(0, 1);
  assert.equal(ping(p, a.id, '192.168.1.11').success, false);
});

test('des VLAN différents isolent les PC ; le même VLAN les relie', () => {
  const { p, sw, a } = lan();
  sw.config.vlans!.push({ id: 10, name: 'A' });
  getPort(sw, 'FastEthernet0/1')!.accessVlan = 10;
  assert.equal(ping(p, a.id, '192.168.1.11').success, false);
  getPort(sw, 'FastEthernet0/2')!.accessVlan = 10;
  assert.equal(ping(p, a.id, '192.168.1.11').success, true);
});

test('un VLAN supprimé rend ses ports inactifs', () => {
  const { p, sw, a } = lan();
  getPort(sw, 'FastEthernet0/1')!.accessVlan = 20;
  getPort(sw, 'FastEthernet0/2')!.accessVlan = 20;
  const r = ping(p, a.id, '192.168.1.11');
  assert.equal(r.success, false);
  assert.match(r.reason!, /VLAN 20 n'existe pas/);
});

test('routage entre deux réseaux via un routeur, réponse impossible sans passerelle', () => {
  const p = createProject();
  const r = addDevice(p, 'cisco-2911', 0, 0, 'R1');
  const a = addDevice(p, 'pc', 0, 0, 'PC1'), b = addDevice(p, 'pc', 0, 0, 'PC2');
  connect(p, { device: a.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/0' });
  connect(p, { device: b.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/1' });
  Object.assign(getPort(r, 'GigabitEthernet0/0')!, { ip: '10.0.1.1', mask: '255.255.255.0', adminUp: true });
  Object.assign(getPort(r, 'GigabitEthernet0/1')!, { ip: '10.0.2.1', mask: '255.255.255.0', adminUp: true });
  Object.assign(a.config.host!, { ip: '10.0.1.10', mask: '255.255.255.0', gateway: '10.0.1.1' });
  Object.assign(b.config.host!, { ip: '10.0.2.10', mask: '255.255.255.0', gateway: '' });
  const r1 = ping(p, a.id, '10.0.2.10');
  assert.equal(r1.success, false);
  assert.match(r1.reason!, /réponse ne peut pas revenir/);
  b.config.host!.gateway = '10.0.2.1';
  const r2 = ping(p, a.id, '10.0.2.10');
  assert.equal(r2.success, true);
  assert.equal(r2.ttl, 127);
});

test('DHCP : un serveur générique attribue une adresse réelle', () => {
  const { p, b } = lan();
  const srv = addDevice(p, 'server', 0, 0, 'S1');
  connect(p, { device: srv.id, port: 'FastEthernet0' }, { device: p.devices[0].id, port: 'FastEthernet0/3' });
  Object.assign(srv.config.host!, { ip: '192.168.1.2', mask: '255.255.255.0' });
  srv.config.dhcpService = { enabled: true, poolStart: '192.168.1.100', mask: '255.255.255.0', maxUsers: 10, gateway: '192.168.1.1', dns: '' };
  const r = dhcpRenew(p, b.id);
  assert.equal(r.ok, true);
  assert.equal(b.config.host!.ip, '192.168.1.100');
  srv.config.dhcpService.enabled = false;
  const r2 = dhcpRenew(p, b.id);
  assert.equal(r2.ok, false);
  assert.match(b.config.host!.ip, /^169\.254\./);
});
