import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXAMPLES} from '../src/model/examples';
import {EXERCISES} from '../src/learn/exercises';
import {deviceByName,connect,getPort} from '../src/model/project';
import {cloneDevice} from '../src/devices/factory';
import {dhcpRenew} from '../src/sim/dhcp';
import {ping} from '../src/sim/engine';
import {parseProject,serializeProject,ProjectFormatError} from '../src/storage/serialize';
import {harness} from './helpers';

test('DHCP refuse adresses réseau, diffusion, pool hors réseau et passerelle invalide',()=>{
 for(const [start,gw] of [['192.168.1.0',''],['192.168.1.255',''],['10.5.0.10',''],['192.168.1.100','10.0.0.1'],['192.168.1.100','999.1.1.1']]) {
  const p=EXAMPLES.find(e=>e.id==='dhcp-server')!.build(), pc=deviceByName(p,'PC1')!,server=deviceByName(p,'Serveur1')!;
  server.config.dhcpService!.poolStart=start;server.config.dhcpService!.gateway=gw;
  const result=dhcpRenew(p,pc.id);assert.equal(result.ok,false,`${start},${gw}`);assert.match(pc.config.host!.ip,/^169\.254\./);
 }
});
test('DHCP : bail correct puis changement de plage ne réutilise pas un ancien bail hors plage',()=>{
 const p=EXAMPLES.find(e=>e.id==='dhcp-server')!.build(),pc=deviceByName(p,'PC1')!,server=deviceByName(p,'Serveur1')!;
 assert.equal(dhcpRenew(p,pc.id).ok,true);assert.equal(pc.config.host!.ip,'192.168.1.100');
 server.config.dhcpService!.poolStart='192.168.1.150';assert.equal(dhcpRenew(p,pc.id).ok,true);assert.equal(pc.config.host!.ip,'192.168.1.150');
});
test('ipconfig /release préserve une configuration statique et libère un bail DHCP',()=>{
 let p=EXAMPLES.find(e=>e.id==='local')!.build(),h=harness(p),before=structuredClone(h.dev('PC1').config.host!);
 assert.match(h.run('PC1','ipconfig /release').join('\n'),/statique/);assert.deepEqual(h.dev('PC1').config.host,before);
 p=EXAMPLES.find(e=>e.id==='dhcp-server')!.build();h=harness(p);h.run('PC1','ipconfig /renew');assert.equal(h.dev('PC1').config.host!.ip,'192.168.1.100');h.run('PC1','ipconfig /release');assert.equal(h.dev('PC1').config.host!.ip,'');assert.equal(h.dev('Serveur1').config.leases!.length,0);
});
test('import rejette ACL et structures imbriquées corrompues sans casser les projets précédents',()=>{
 const p=EXAMPLES.find(e=>e.id==='firewall')!.build();const bad=(f:(x:any)=>void)=>{const x=JSON.parse(serializeProject(p));f(x);return JSON.stringify(x)};
 assert.throws(()=>parseProject(bad(x=>x.devices.find((d:any)=>d.name==='FW1').config.acls=[{id:'FILTRE-1',type:'extended'}])),ProjectFormatError);
 assert.throws(()=>parseProject(bad(x=>x.devices.find((d:any)=>d.name==='FW1').config.acls[0].entries[0].src=null)),ProjectFormatError);
 assert.throws(()=>parseProject(bad(x=>x.devices.find((d:any)=>d.name==='FW1').ports[0].ip={})),ProjectFormatError);
 assert.throws(()=>parseProject(bad(x=>x.devices.find((d:any)=>d.name==='FW1').config.routes=[{network:{},mask:'255.255.255.0'}])),ProjectFormatError);
 for(const e of EXAMPLES){const project=e.build();assert.deepEqual(parseProject(serializeProject(project)),project,e.id)}
 for(const e of EXERCISES){const project=e.build();assert.deepEqual(parseProject(serializeProject(project)),project,e.id)}
});
test('conflit IP joignable signalé, mais pas de faux conflit entre VLAN isolés',()=>{
 const p=EXAMPLES.find(e=>e.id==='local')!.build(),a=deviceByName(p,'PC1')!,b=deviceByName(p,'PC2')!,sw=deviceByName(p,'SW1')!,c=cloneDevice(b,'PC3');p.devices.push(c);connect(p,{device:c.id,port:'FastEthernet0'},{device:sw.id,port:'FastEthernet0/3'});
 let r=ping(p,a.id,b.config.host!.ip);assert.equal(r.success,false);assert.match(r.reason!,/Conflit d’adresse IP/);
 sw.config.vlans!.push({id:20,name:'isolé'});getPort(sw,'FastEthernet0/3')!.accessVlan=20;r=ping(p,a.id,b.config.host!.ip);assert.equal(r.success,true);
});
