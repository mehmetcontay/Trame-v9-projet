import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addDevice, connect, getPort } from '../src/model/project';
import { ping } from '../src/sim/engine';
import { dhcpRenew } from '../src/sim/dhcp';
import { serializeProject, parseProject } from '../src/storage/serialize';

test('Wi-Fi simplifié : ping et DHCP traversent le pont, coupure et ports incompatibles', () => {
  const p = createProject();
  const pc = addDevice(p, 'laptop', 20, 20), ap = addDevice(p, 'ap', 100, 20), sw = addDevice(p, 'at-x230', 200, 20), server = addDevice(p, 'server', 300, 20);
  connect(p, {device: pc.id, port: 'WiFi0'}, {device: ap.id, port:'Radio1'});
  connect(p, {device: ap.id, port:'Ethernet0'}, {device:sw.id, port:'port1.0.1'});
  connect(p, {device: server.id, port:'FastEthernet0'}, {device:sw.id, port:'port1.0.2'});
  Object.assign(server.config.host!, {ip:'192.168.1.2', mask:'255.255.255.0'});
  server.config.dhcpService = {enabled:true, poolStart:'192.168.1.100', mask:'255.255.255.0', maxUsers:10, gateway:'', dns:''};
  assert.equal(dhcpRenew(p, pc.id).ok, true);
  assert.equal(ping(p, pc.id, '192.168.1.2').success, true);
  const restored = parseProject(serializeProject(p));
  assert.deepEqual(restored, p);
  assert.equal(ping(restored, pc.id, '192.168.1.2').success, true);
  getPort(ap, 'Radio1')!.adminUp = false;
  assert.equal(ping(p, pc.id, '192.168.1.2').success, false);
  const phone = addDevice(p, 'dect-phone', 0, 0);
  assert.throws(() => connect(p, {device: phone.id, port:'DECT0'}, {device:ap.id, port:'Radio2'}), /incompatibles/);
});

test('DECT pédagogique : deux combinés joignables puis isolés', () => {
  const p = createProject();
  const a = addDevice(p, 'dect-phone', 0, 0), b = addDevice(p, 'dect-phone', 0, 0), base = addDevice(p, 'dect-base', 0, 0);
  connect(p,{device:a.id,port:'DECT0'}, {device:base.id,port:'DECT1'});
  connect(p,{device:b.id,port:'DECT0'}, {device:base.id,port:'DECT2'});
  Object.assign(a.config.host!, {ip:'10.1.1.1', mask:'255.255.255.0'});
  Object.assign(b.config.host!, {ip:'10.1.1.2', mask:'255.255.255.0'});
  assert.equal(ping(p, a.id, b.config.host!.ip).success, true);
  p.links.pop();
  assert.equal(ping(p, a.id, b.config.host!.ip).success, false);
});

test('second modèle Cisco Gigabit : ports disponibles et connectivité', () => {
  const p = createProject(), sw = addDevice(p,'cisco-2960g',0,0), a = addDevice(p,'pc',0,0), b = addDevice(p,'pc',0,0);
  assert.equal(sw.ports.length, 24);
  connect(p,{device:a.id,port:'FastEthernet0'},{device:sw.id,port:'GigabitEthernet0/1'});
  connect(p,{device:b.id,port:'FastEthernet0'},{device:sw.id,port:'GigabitEthernet0/2'});
  Object.assign(a.config.host!,{ip:'192.168.1.1',mask:'255.255.255.0'}); Object.assign(b.config.host!,{ip:'192.168.1.2',mask:'255.255.255.0'});
  assert.equal(ping(p, a.id, '192.168.1.2').success, true);
});
