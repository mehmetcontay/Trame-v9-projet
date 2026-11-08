import {test} from 'node:test';import assert from 'node:assert/strict';import {createProject,addDevice,connect} from '../src/model/project';import {ping} from '../src/sim/engine';import {harness} from './helpers';import {parseProject,serializeProject} from '../src/storage/serialize';
test('AR4050S partiel : interfaces eth, routage IPv4, persistance et coupure',()=>{
 const p=createProject(),r=addDevice(p,'at-ar4050s',0,0,'AR1'),a=addDevice(p,'pc',0,0,'PC1'),b=addDevice(p,'pc',0,0,'PC2');
 connect(p,{device:a.id,port:'FastEthernet0'},{device:r.id,port:'eth1'});connect(p,{device:b.id,port:'FastEthernet0'},{device:r.id,port:'eth2'});
 Object.assign(a.config.host!,{ip:'10.1.1.2',mask:'255.255.255.0',gateway:'10.1.1.1'});Object.assign(b.config.host!,{ip:'10.2.2.2',mask:'255.255.255.0',gateway:'10.2.2.1'});
 const h=harness(p);const out=h.run('AR1','enable','configure terminal','interface eth1','ip address 10.1.1.1/24','no shutdown','exit','interface eth2','ip address 10.2.2.1/24','no shutdown','end');assert.ok(!out.some(x=>/Invalid|Error/.test(x)),out.join('\n'));
 assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,true);assert.match(h.run('AR1','show ip interface brief').join('\n'),/eth1\s+10\.1\.1\.1/);assert.match(h.run('AR1','show ip route').join('\n'),/10\.2\.2\.0\/24/);assert.match(h.run('AR1','show run').join('\n'),/interface eth1\n ip address 10\.1\.1\.1\/24/);
 h.run('AR1','copy running-config startup-config');const back=parseProject(serializeProject(h.state.p));assert.equal(ping(back,a.id,'10.2.2.2').success,true);
 h.run('AR1','conf t','interface eth2','shutdown','end');assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,false);h.run('AR1','reload');assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,true);
});
test('AR4050S : routes statiques entre deux routeurs',()=>{
 const p=createProject(),ar=addDevice(p,'at-ar4050s',0,0,'AR1'),r=addDevice(p,'cisco-2911',0,0,'R1'),a=addDevice(p,'pc',0,0,'PC1'),b=addDevice(p,'pc',0,0,'PC2');
 connect(p,{device:a.id,port:'FastEthernet0'},{device:ar.id,port:'eth1'});connect(p,{device:ar.id,port:'eth2'},{device:r.id,port:'GigabitEthernet0/0'});connect(p,{device:r.id,port:'GigabitEthernet0/1'},{device:b.id,port:'FastEthernet0'});
 Object.assign(a.config.host!,{ip:'10.1.1.2',mask:'255.255.255.0',gateway:'10.1.1.1'});Object.assign(b.config.host!,{ip:'10.2.2.2',mask:'255.255.255.0',gateway:'10.2.2.1'});
 const h=harness(p);h.run('AR1','enable','conf t','int eth1','ip address 10.1.1.1/24','no shutdown','exit','int eth2','ip address 172.16.0.1/24','no shutdown','end');h.run('R1','enable','conf t','int g0/0','ip address 172.16.0.2 255.255.255.0','no shutdown','exit','int g0/1','ip address 10.2.2.1 255.255.255.0','no shutdown','exit','ip route 10.1.1.0 255.255.255.0 172.16.0.1','end');
 assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,false);const out=h.run('AR1','conf t','ip route 10.2.2.0/24 172.16.0.2','end');assert.ok(!out.some(x=>/Invalid|Error/.test(x)),out.join('\n'));assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,true);assert.match(h.run('AR1','show ip route').join('\n'),/10\.2\.2\.0\/24/);
 h.run('AR1','conf t','no ip route 10.2.2.0/24 172.16.0.2','end');assert.equal(ping(h.state.p,a.id,'10.2.2.2').success,false);
});
