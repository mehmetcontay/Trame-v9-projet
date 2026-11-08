import {test} from 'node:test';import assert from 'node:assert/strict';
import {createProject,addDevice,connect} from '../src/model/project';import {harness} from './helpers';import {ping} from '../src/sim/engine';import {serializeProject,parseProject} from '../src/storage/serialize';

test('3560 : routage inter-VLAN activable, désactivable et persistant',()=>{
 const p=createProject(),s=addDevice(p,'cisco-3560',0,0,'MLS1'),a=addDevice(p,'pc',0,0,'PC1'),b=addDevice(p,'pc',0,0,'PC2');
 connect(p,{device:a.id,port:'FastEthernet0'},{device:s.id,port:'FastEthernet0/1'});connect(p,{device:b.id,port:'FastEthernet0'},{device:s.id,port:'FastEthernet0/2'});
 Object.assign(a.config.host!,{ip:'10.0.10.2',mask:'255.255.255.0',gateway:'10.0.10.1'});Object.assign(b.config.host!,{ip:'10.0.20.2',mask:'255.255.255.0',gateway:'10.0.20.1'});
 const h=harness(p);const out=h.run('MLS1','en','conf t','vlan 10','vlan 20','exit','int fa0/1','switchport access vlan 10','int fa0/2','switchport access vlan 20','int vlan 10','ip address 10.0.10.1 255.255.255.0','no shutdown','int vlan 20','ip address 10.0.20.1 255.255.255.0','no shutdown','end');
 assert.ok(!out.some(x=>x.includes('Invalid input')),out.join('\n'));assert.equal(ping(h.state.p,a.id,'10.0.20.2').success,false);
 h.run('MLS1','conf t','ip routing','end');assert.equal(ping(h.state.p,a.id,'10.0.20.2').success,true);assert.match(h.run('MLS1','show ip route').join('\n'),/10\.0\.20\.0\/24/);assert.match(h.run('MLS1','show running-config').join('\n'),/ip routing/);
 h.run('MLS1','copy run start');let back=parseProject(serializeProject(h.state.p));assert.equal(ping(back,a.id,'10.0.20.2').success,true);
 h.run('MLS1','conf t','no ip routing','end');assert.equal(ping(h.state.p,a.id,'10.0.20.2').success,false);h.run('MLS1','reload');assert.equal(ping(h.state.p,a.id,'10.0.20.2').success,true);
 h.run('MLS1','en','conf t','int vlan 20','shutdown','end');assert.equal(ping(h.state.p,a.id,'10.0.20.2').success,false);
});
