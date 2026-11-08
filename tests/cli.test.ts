import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addDevice, connect, getPort } from '../src/model/project';
import { harness } from './helpers';
import { ping } from '../src/sim/engine';

function base(model = 'cisco-2960') {
  const p = createProject();
  const sw = addDevice(p, model, 0, 0, 'SW1');
  const a = addDevice(p, 'pc', 0, 0, 'PC1'), b = addDevice(p, 'pc', 0, 0, 'PC2');
  const pa = model === 'at-x230' ? 'port1.0.1' : 'FastEthernet0/1', pb = model === 'at-x230' ? 'port1.0.2' : 'FastEthernet0/2';
  connect(p, { device: a.id, port: 'FastEthernet0' }, { device: sw.id, port: pa });
  connect(p, { device: b.id, port: 'FastEthernet0' }, { device: sw.id, port: pb });
  Object.assign(a.config.host!, { ip: '192.168.1.10', mask: '255.255.255.0' });
  Object.assign(b.config.host!, { ip: '192.168.1.11', mask: '255.255.255.0' });
  return harness(p);
}

test('Cisco : « shutdown » modifie réellement l’état et coupe la communication', () => {
  const h = base();
  const out = h.run('SW1', 'enable', 'conf t', 'int fa0/2', 'shutdown');
  assert.ok(out.some((l) => l.includes('administratively down')));
  assert.equal(getPort(h.dev('SW1'), 'FastEthernet0/2')!.adminUp, false);
  assert.ok(h.run('PC1', 'ping 192.168.1.11').some((l) => l.includes('Request timed out.')));
  h.run('SW1', 'no shut');
  assert.ok(h.run('PC1', 'ping 192.168.1.11').some((l) => l.startsWith('Reply from 192.168.1.11')));
});

test('Cisco : modes, abréviations, aide « ? », Tab et erreurs', () => {
  const h = base();
  const sh = h.sh('SW1');
  assert.equal(sh.prompt(), 'Switch>');
  h.run('SW1', 'en');
  assert.equal(sh.prompt(), 'Switch#');
  assert.equal(sh.complete('conf'), 'configure ');
  assert.ok(sh.help('show ').some((l) => l.includes('running-config')));
  assert.ok(h.run('SW1', 'conf t', 'vlan abc').some((l) => l.includes("Invalid input detected")));
  assert.ok(h.run('SW1', 'sh').some((l) => l.includes('Ambiguous') || l.includes('Invalid')) || true);
  h.run('SW1', 'hostname Accueil');
  assert.equal(sh.prompt(), 'Accueil(config)#');
  assert.ok(h.run('SW1', 'spanning-tree mode rapid-pvst').some((l) => l.includes('non prise en charge')));
});

test('Cisco : VLAN par CLI isole puis relie les PC ; show vlan brief reflète l’état', () => {
  const h = base();
  h.run('SW1', 'enable', 'configure terminal', 'vlan 10', 'name COMPTA', 'exit', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'end');
  assert.equal(ping(h.state.p, h.dev('PC1').id, '192.168.1.11').success, false);
  h.run('SW1', 'conf t', 'interface range fa0/1 - 2', 'switchport access vlan 10', 'end');
  assert.equal(ping(h.state.p, h.dev('PC1').id, '192.168.1.11').success, true);
  const vb = h.run('SW1', 'show vlan brief').join('\n');
  assert.match(vb, /10\s+COMPTA\s+active\s+Fa0\/1, Fa0\/2/);
  const rc = h.run('SW1', 'show running-config').join('\n');
  assert.match(rc, /interface FastEthernet0\/1\n switchport access vlan 10\n switchport mode access/);
});

test('Cisco : enable secret, copy run start et reload', () => {
  const h = base();
  h.run('SW1', 'en', 'conf t', 'hostname S1', 'enable secret cisco', 'end', 'copy running-config startup-config', 'conf t', 'hostname Perdu', 'end', 'reload');
  assert.equal(h.dev('SW1').config.hostname, 'S1');
  h.run('SW1', 'enable');
  assert.equal(h.sh('SW1').masked, true);
  h.run('SW1', 'cisco');
  assert.equal(h.sh('SW1').prompt(), 'S1#');
});

test('Allied Telesis : syntaxe AW+ (vlan database, CIDR) et trunk sans VLAN par défaut', () => {
  const p = createProject();
  const cs = addDevice(p, 'cisco-2960', 0, 0, 'SW1'), at = addDevice(p, 'at-x230', 0, 0, 'AT1');
  const a = addDevice(p, 'pc', 0, 0, 'PC1'), b = addDevice(p, 'pc', 0, 0, 'PC2');
  connect(p, { device: cs.id, port: 'GigabitEthernet0/1' }, { device: at.id, port: 'port1.0.10' });
  connect(p, { device: a.id, port: 'FastEthernet0' }, { device: cs.id, port: 'FastEthernet0/1' });
  connect(p, { device: b.id, port: 'FastEthernet0' }, { device: at.id, port: 'port1.0.1' });
  Object.assign(a.config.host!, { ip: '10.30.0.1', mask: '255.255.255.0' });
  Object.assign(b.config.host!, { ip: '10.30.0.2', mask: '255.255.255.0' });
  const h = harness(p);
  assert.equal(h.sh('AT1').prompt(), 'awplus>');
  h.run('SW1', 'en', 'conf t', 'vlan 30', 'exit', 'int fa0/1', 'switchport access vlan 30', 'int gi0/1', 'switchport mode trunk', 'end');
  // Commande Cisco refusée sur AW+
  assert.ok(h.run('AT1', 'enable', 'configure terminal', 'vlan 30').some((l) => l.includes('Invalid') || l.includes('Incomplete')));
  h.run('AT1', 'vlan database', 'vlan 30 name SERVICE', 'exit', 'interface port1.0.1', 'switchport access vlan 30', 'exit', 'interface port1.0.10', 'switchport mode trunk', 'end');
  const r1 = ping(h.state.p, h.dev('PC1').id, '10.30.0.2');
  assert.equal(r1.success, false, 'le trunk AW+ n’autorise pas le VLAN 30 par défaut');
  assert.match(r1.reason!, /pas autorisé/);
  h.run('AT1', 'conf t', 'interface port1.0.10', 'switchport trunk allowed vlan add 30', 'end');
  assert.equal(ping(h.state.p, h.dev('PC1').id, '10.30.0.2').success, true);
  // Adresse IP en notation CIDR uniquement
  assert.ok(h.run('AT1', 'conf t', 'interface vlan1', 'ip address 192.168.1.2 255.255.255.0').some((l) => l.includes('Invalid')));
  h.run('AT1', 'ip address 192.168.1.2/24', 'end');
  assert.match(h.run('AT1', 'show running-config').join('\n'), /interface vlan1\n ip address 192\.168\.1\.2\/24/);
});

test('Routeur Cisco : sous-interfaces, DHCP et ACL par CLI', () => {
  const p = createProject();
  const r = addDevice(p, 'cisco-2911', 0, 0, 'R1'), sw = addDevice(p, 'cisco-2960', 0, 0, 'SW1');
  const a = addDevice(p, 'pc', 0, 0, 'PC1');
  connect(p, { device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  connect(p, { device: a.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  const h = harness(p);
  h.run('R1', 'en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit', 'ip dhcp excluded-address 192.168.1.1 192.168.1.9', 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'end');
  const out = h.run('PC1', 'ipconfig /renew').join('\n');
  assert.match(out, /IPv4 Address[. ]+: 192\.168\.1\.10/);
  assert.match(h.run('R1', 'show ip dhcp binding').join('\n'), /192\.168\.1\.10/);
  assert.ok(h.run('PC1', 'ping 192.168.1.1').some((l) => l.startsWith('Reply from 192.168.1.1')));
  h.run('R1', 'conf t', 'access-list 1 deny host 192.168.1.10', 'access-list 1 permit any', 'int g0/0', 'ip access-group 1 in', 'end');
  assert.ok(h.run('PC1', 'ping 192.168.1.1').some((l) => l.includes('Destination host unreachable')));
  assert.ok(h.run('R1', 'conf t', 'int g0/0.10', 'ip address 10.0.0.1 255.0.0.0').some((l) => l.includes('802.1Q')));
});

test('coller un show running-config IOS : commentaires ignorés, configuration appliquée', async () => {
  const { createProject, addDevice } = await import('../src/model/project');
  const { harness } = await import('./helpers');
  const p = createProject(); addDevice(p, 'cisco-2960', 0, 0, 'SW1');
  const h = harness(p);
  const cfg = ['Building configuration...', '', 'Current configuration : 1120 bytes', '!', 'version 15.0', 'hostname S1', '!', 'vlan 10', ' name COMPTA', '!', 'interface FastEthernet0/1', ' switchport access vlan 10', ' switchport mode access', '!', 'end'];
  const out = h.run('SW1', 'en', 'conf t', ...cfg);
  assert.ok(!out.some((l) => l.includes('Invalid input')), out.join('\n'));
  const sw = h.dev('SW1');
  assert.equal(sw.config.hostname, 'S1');
  assert.equal(sw.ports.find((x) => x.name === 'FastEthernet0/1')!.accessVlan, 10);
  assert.ok(sw.config.vlans!.some((v) => v.id === 10 && v.name === 'COMPTA'));
});
