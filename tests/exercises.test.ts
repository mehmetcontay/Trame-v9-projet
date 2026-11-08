import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, getExercise } from '../src/learn/exercises';
import { harness } from './helpers';
import { connect, deviceByName } from '../src/model/project';

test('toutes les topologies d’exercice se construisent et ne sont pas résolues au départ', () => {
  for (const e of EXERCISES) {
    const r = e.check(e.build());
    assert.equal(r.ok, false, `${e.id} ne devrait pas être réussi d’emblée`);
    assert.ok(r.items.length > 0);
  }
});

test('exercice 1 : réussi après configuration des IP, échec expliqué sinon', () => {
  const e = getExercise('ex-deux-pc')!;
  const p = e.build();
  const h = harness(p);
  Object.assign(h.dev('PC1').config.host!, { ip: '192.168.1.10', mask: '255.255.255.0' });
  Object.assign(h.dev('PC2').config.host!, { ip: '192.168.2.11', mask: '255.255.255.0' });
  const bad = e.check(h.state.p);
  assert.equal(bad.ok, false);
  assert.ok(bad.items.some((i) => !i.ok && i.detail));
  h.dev('PC2').config.host!.ip = '192.168.1.11';
  assert.equal(e.check(h.state.p).ok, true);
});

test('exercice VLAN validé par des commandes Cisco réelles', () => {
  const e = getExercise('ex-vlan')!;
  const h = harness(e.build());
  h.run('SW1', 'en', 'conf t', 'vlan 10', 'name COMPTA', 'vlan 20', 'name RH', 'exit', 'int range fa0/1 - 2', 'sw mo acc', 'sw acc vl 10', 'int range fa0/3 - 4', 'switchport access vlan 20', 'end');
  const r = e.check(h.state.p);
  assert.equal(r.ok, true, JSON.stringify(r.items.filter((i) => !i.ok)));
});

test('exercices avancés : router-on-a-stick, DHCP, Cisco + Allied Telesis, ACL', () => {
  let h = harness(getExercise('ex-roas')!.build());
  h.run('SW1', 'en', 'conf t', 'int gi0/1', 'switchport mode trunk', 'end');
  h.run('R1', 'en', 'conf t', 'int g0/0', 'no shut', 'int g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'int g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'end');
  assert.equal(getExercise('ex-roas')!.check(h.state.p).ok, true);

  h = harness(getExercise('ex-dhcp')!.build());
  h.run('R1', 'en', 'conf t', 'ip dhcp excluded-address 192.168.1.1 192.168.1.9', 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'end');
  h.run('PC1', 'ipconfig /renew'); h.run('PC2', 'ipconfig /renew');
  assert.equal(getExercise('ex-dhcp')!.check(h.state.p).ok, true);

  h = harness(getExercise('ex-allied')!.build());
  h.run('SW1', 'en', 'conf t', 'vlan 30', 'int fa0/1', 'switchport access vlan 30', 'int gi0/1', 'switchport mode trunk', 'end');
  h.run('AT-SW1', 'en', 'conf t', 'vlan database', 'vlan 30', 'exit', 'int port1.0.1', 'switchport access vlan 30', 'exit', 'int port1.0.10', 'switchport mode trunk', 'switchport trunk allowed vlan add 30', 'end');
  assert.equal(getExercise('ex-allied')!.check(h.state.p).ok, true);

  h = harness(getExercise('ex-acl')!.build());
  h.run('R1', 'en', 'conf t', 'access-list 10 deny host 192.168.1.11', 'access-list 10 permit any', 'int g0/1', 'ip access-group 10 out', 'end');
  assert.equal(getExercise('ex-acl')!.check(h.state.p).ok, true);
});

test('exercices de câblage et de dépannage', () => {
  let h = harness(getExercise('ex-cablage')!.build());
  const p = h.state.p;
  connect(p, { device: deviceByName(p, 'PC1')!.id, port: 'FastEthernet0' }, { device: deviceByName(p, 'SW1')!.id, port: 'FastEthernet0/5' });
  connect(p, { device: deviceByName(p, 'PC2')!.id, port: 'FastEthernet0' }, { device: deviceByName(p, 'SW1')!.id, port: 'FastEthernet0/9' });
  assert.equal(getExercise('ex-cablage')!.check(p).ok, true);

  h = harness(getExercise('ex-depannage')!.build());
  h.run('SW1', 'en', 'conf t', 'int fa0/2', 'no shutdown', 'end');
  assert.equal(getExercise('ex-depannage')!.check(h.state.p).ok, false);
  h.dev('PC3').config.host!.ip = '192.168.5.3';
  assert.equal(getExercise('ex-depannage')!.check(h.state.p).ok, true);

  h = harness(getExercise('ex-passerelle')!.build());
  h.run('R1', 'en', 'conf t', 'int g0/0', 'ip add 192.168.1.1 255.255.255.0', 'no sh', 'int g0/1', 'ip add 192.168.2.1 255.255.255.0', 'no sh', 'end');
  h.dev('PC1').config.host!.gateway = '192.168.1.1'; h.dev('PC2').config.host!.gateway = '192.168.2.1';
  assert.equal(getExercise('ex-passerelle')!.check(h.state.p).ok, true);

  h = harness(getExercise('ex-trunk')!.build());
  for (const s of ['SW1', 'SW2']) h.run(s, 'en', 'conf t', 'vlan 10', 'vlan 20', 'exit', 'int fa0/1', 'sw acc vl 10', 'int fa0/2', 'sw acc vl 20', 'int gi0/1', 'sw mo tr', 'end');
  assert.equal(getExercise('ex-trunk')!.check(h.state.p).ok, true);
});
