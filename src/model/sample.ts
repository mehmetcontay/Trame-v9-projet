// Projet d'exemple : deux réseaux reliés par un routeur, prêt à être testé.
import { createProject, addDevice, connect, getPort } from './project';
import type { Project } from './types';

export function sampleProject(): Project {
  const p = createProject('Exemple — deux réseaux et un routeur');
  const r = addDevice(p, 'cisco-2911', 420, 140, 'R1');
  const sw = addDevice(p, 'cisco-2960', 220, 300, 'SW1');
  const pc0 = addDevice(p, 'pc', 90, 470, 'PC0');
  const pc1 = addDevice(p, 'pc', 330, 470, 'PC1');
  const srv = addDevice(p, 'server', 640, 300, 'Serveur0');
  r.config.hostname = 'R1'; sw.config.hostname = 'SW1';
  Object.assign(getPort(r, 'GigabitEthernet0/0')!, { adminUp: true, ip: '192.168.1.1', mask: '255.255.255.0' });
  Object.assign(getPort(r, 'GigabitEthernet0/1')!, { adminUp: true, ip: '192.168.2.1', mask: '255.255.255.0' });
  Object.assign(pc0.config.host!, { mode: 'static', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' });
  Object.assign(pc1.config.host!, { mode: 'static', ip: '192.168.1.11', mask: '255.255.255.0', gateway: '192.168.1.1' });
  Object.assign(srv.config.host!, { mode: 'static', ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' });
  connect(p, { device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  connect(p, { device: sw.id, port: 'FastEthernet0/1' }, { device: pc0.id, port: 'FastEthernet0' });
  connect(p, { device: sw.id, port: 'FastEthernet0/2' }, { device: pc1.id, port: 'FastEthernet0' });
  connect(p, { device: r.id, port: 'GigabitEthernet0/1' }, { device: srv.id, port: 'FastEthernet0' });
  p.notes.push({ id: 'note_1', x: 560, y: 470, text: 'Essayez : double-cliquez sur PC0 puis tapez « ping 192.168.2.10 ».' });
  return p;
}
