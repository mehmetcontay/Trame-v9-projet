import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, MemoryKV } from '../src/storage/store';
import { parseProject, serializeProject, ProjectFormatError, isPacketTracerFile } from '../src/storage/serialize';
import { EXERCISES } from '../src/learn/exercises';
import { harness } from './helpers';
import { ping } from '../src/sim/engine';

test('sauvegarde puis restauration d’un projet (topologie, câbles, configuration)', async () => {
  const p = EXERCISES.find((e) => e.id === 'ex-vlan')!.build();
  const h = harness(p);
  h.run('SW1', 'en', 'conf t', 'vlan 10', 'name COMPTA', 'end', 'copy run start');
  const store = new ProjectStore(new MemoryKV());
  await store.save(h.state.p);
  const list = await store.list();
  assert.equal(list.length, 1);
  const back = await store.load(h.state.p.id);
  assert.deepEqual(back, h.state.p);
  assert.equal(back.devices.find((d) => d.name === 'SW1')!.config.vlans!.find((v) => v.id === 10)!.name, 'COMPTA');
  assert.ok(back.devices.find((d) => d.name === 'SW1')!.startup);
  assert.equal(back.links.length, 4);
  // le projet restauré fonctionne toujours
  assert.equal(ping(back, back.devices.find((d) => d.name === 'PC1')!.id, '192.168.1.2').success, true);
});

test('export / import fichier et rejet des fichiers invalides', () => {
  const p = EXERCISES[0].build();
  const text = serializeProject(p);
  assert.deepEqual(parseProject(text), p);
  assert.throws(() => parseProject('{"format":"autre"}'), ProjectFormatError);
  assert.throws(() => parseProject('pas du json'), ProjectFormatError);
  assert.equal(isPacketTracerFile('lab.pkt'), true);
});

test('import : refuse les projets incomplets, les ports occupés et les liaisons impossibles', () => {
  const p = EXERCISES[0].build();
  const modify = (f: (x: any) => void) => { const x = JSON.parse(serializeProject(p)); f(x); return JSON.stringify(x); };
  assert.throws(() => parseProject(modify(x => x.devices[0].ports[0].mac = null)), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.devices[0].ports.pop())), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.devices[1].config.host = null)), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.devices.push({...x.devices[0]}))), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.links.push({...x.links[0], id:'doublon'}))), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.links[0].b.port = 'inconnu')), ProjectFormatError);
  assert.throws(() => parseProject(modify(x => x.notes[0].x = 'oops')), ProjectFormatError);
});
