// Exercices pratiques : topologie de départ, objectifs, indices progressifs et vérification sur l'état réel.
import type { Project, Device } from '../model/types';
import { createProject, addDevice, connect, deviceByName, findLink, getPort } from '../model/project';
import { ping } from '../sim/engine';
import { l3Interfaces } from '../sim/topology';
import { inSubnet, isUsableHost, isIp, isMask } from '../sim/ip';

export interface CheckItem { label: string; ok: boolean; detail?: string }
export interface CheckResult { ok: boolean; items: CheckItem[] }
export interface Exercise {
  id: string;
  level: 'Débutant' | 'Intermédiaire' | 'Avancé';
  title: string;
  objective: string;
  steps: string[];
  hints: string[];
  build(): Project;
  check(p: Project): CheckResult;
}

// ---------- construction ----------
class B {
  p: Project;
  constructor(title: string, exId: string) { this.p = createProject(`Exercice — ${title}`); this.p.exerciseId = exId; }
  add(model: string, name: string, x: number, y: number) { return addDevice(this.p, model, x, y, name); }
  link(a: Device, pa: string, b: Device, pb: string) { connect(this.p, { device: a.id, port: pa }, { device: b.id, port: pb }); return this; }
  ip(d: Device, ip: string, mask = '255.255.255.0', gw = '') { Object.assign(d.config.host!, { mode: 'static', ip, mask, gateway: gw }); return this; }
  note(x: number, y: number, text: string) { this.p.notes.push({ id: `note_${this.p.notes.length}`, x, y, text }); return this; }
  vlan(sw: Device, id: number, name: string) { sw.config.vlans!.push({ id, name }); sw.config.vlans!.sort((a, b) => a.id - b.id); return this; }
  access(sw: Device, port: string, v: number) { getPort(sw, port)!.accessVlan = v; return this; }
  rip(r: Device, port: string, ip: string, mask = '255.255.255.0') { Object.assign(getPort(r, port)!, { ip, mask, adminUp: true }); return this; }
}

// ---------- vérifications ----------
const item = (label: string, ok: boolean, detail?: string): CheckItem => ({ label, ok, detail: ok ? undefined : detail });
function dev(p: Project, name: string) { return deviceByName(p, name); }
function ipOf(p: Project, name: string): string { const d = dev(p, name); return d ? (l3Interfaces(p, d)[0]?.ip ?? '') : ''; }
function pingItem(p: Project, a: string, target: string, expect = true, label?: string): CheckItem {
  const da = dev(p, a);
  const ip = isIp(target) ? target : ipOf(p, target);
  const name = label ?? `Ping ${a} → ${target}${expect ? '' : ' bloqué'}`;
  if (!da) return item(name, false, `${a} est introuvable (a-t-il été supprimé ou renommé ?).`);
  if (!ip) return item(name, false, `${target} n'a pas d'adresse IP.`);
  const r = ping(structuredClone(p), da.id, ip);
  if (expect) return item(name, r.success, r.reason ?? 'Le ping échoue.');
  return item(name, !r.success, `Le ping ${a} → ${target} réussit alors qu'il devrait être bloqué.`);
}
function hostIpItem(p: Project, name: string): CheckItem {
  const h = dev(p, name)?.config.host;
  const ok = !!h && isIp(h.ip) && isMask(h.mask) && isUsableHost(h.ip, h.mask);
  return item(`${name} a une adresse IP et un masque valides`, ok, h?.ip ? `L'adresse ${h.ip} / ${h.mask || '(sans masque)'} n'est pas valide pour un hôte.` : `${name} n'a pas encore d'adresse IP.`);
}
function linkedItem(p: Project, a: string, b: string): CheckItem {
  const da = dev(p, a), db = dev(p, b);
  const ok = !!da && !!db && da.ports.some((pt) => { const l = findLink(p, da.id, pt.name); return !!l && (l.a.device === db.id || l.b.device === db.id); });
  return item(`${a} est relié à ${b}`, ok, `Aucun câble entre ${a} et ${b}.`);
}
function vlanItem(p: Project, sw: string, id: number, name?: string): CheckItem {
  const v = dev(p, sw)?.config.vlans?.find((x) => x.id === id);
  const ok = !!v && (!name || v.name.toLowerCase() === name.toLowerCase());
  return item(`VLAN ${id}${name ? ` « ${name} »` : ''} créé sur ${sw}`, ok, !v ? `Le VLAN ${id} n'existe pas sur ${sw}.` : `Le VLAN ${id} s'appelle « ${v.name} » au lieu de « ${name} ».`);
}
function accessItem(p: Project, sw: string, port: string, v: number): CheckItem {
  const pt = dev(p, sw) && getPort(dev(p, sw)!, port);
  const ok = !!pt && pt.mode !== 'trunk' && pt.accessVlan === v;
  return item(`${sw} ${pt?.short ?? port} : port d'accès dans le VLAN ${v}`, ok, pt ? `Mode ${pt.mode}, VLAN ${pt.accessVlan}.` : 'Port introuvable.');
}
function trunkItem(p: Project, sw: string, port: string): CheckItem {
  const pt = dev(p, sw) && getPort(dev(p, sw)!, port);
  return item(`${sw} ${pt?.short ?? port} est en mode trunk`, pt?.mode === 'trunk', `Le port est en mode ${pt?.mode ?? '?'}.`);
}
const result = (items: CheckItem[]): CheckResult => ({ ok: items.every((i) => i.ok), items });

// ---------- exercices ----------
export const EXERCISES: Exercise[] = [
  {
    id: 'ex-deux-pc', level: 'Débutant', title: 'Deux PC et un switch',
    objective: 'Configurez les adresses IP de PC1 et PC2 pour qu’ils puissent communiquer à travers le switch.',
    steps: ['Ouvrez PC1 (double-clic) et allez dans « Configuration IP ».', 'Donnez à PC1 et PC2 deux adresses du même réseau.', 'Testez avec ping depuis l’invite de commandes de PC1.'],
    hints: ['Double-cliquez sur PC1, onglet « Configuration IP ».', 'Exemple : PC1 = 192.168.1.10, PC2 = 192.168.1.11, masque 255.255.255.0 pour les deux.', 'Dans l’invite de commandes de PC1, tapez : ping 192.168.1.11'],
    build() {
      const b = new B('Deux PC et un switch', 'ex-deux-pc');
      const sw = b.add('cisco-2960', 'SW1', 400, 140), pc1 = b.add('pc', 'PC1', 220, 340), pc2 = b.add('pc', 'PC2', 580, 340);
      b.link(pc1, 'FastEthernet0', sw, 'FastEthernet0/1').link(pc2, 'FastEthernet0', sw, 'FastEthernet0/2');
      b.note(300, 470, 'Objectif : PC1 doit pouvoir pinguer PC2');
      return b.p;
    },
    check(p) {
      const a = dev(p, 'PC1')?.config.host, c = dev(p, 'PC2')?.config.host;
      const same = !!a && !!c && isIp(a.ip) && isIp(c.ip) && inSubnet(c.ip, a.ip, a.mask) && inSubnet(a.ip, c.ip, c.mask);
      return result([hostIpItem(p, 'PC1'), hostIpItem(p, 'PC2'), item('PC1 et PC2 sont dans le même réseau', same, 'Les deux adresses (avec leurs masques) doivent appartenir au même réseau.'), pingItem(p, 'PC1', 'PC2')]);
    },
  },
  {
    id: 'ex-cablage', level: 'Débutant', title: 'Brancher les câbles',
    objective: 'Les PC sont déjà configurés. Reliez-les au switch avec des câbles pour qu’ils communiquent.',
    steps: ['Choisissez l’outil « Câble » dans la barre d’outils.', 'Cliquez sur PC1, choisissez FastEthernet0, puis cliquez sur SW1 et choisissez un port libre.', 'Faites de même pour PC2, puis testez avec ping.'],
    hints: ['L’outil Câble se trouve en haut de l’espace de travail (icône de câble) — raccourci : touche C.', 'Un câble est vert quand le lien est actif des deux côtés.', 'Depuis PC1 : ping 192.168.10.2'],
    build() {
      const b = new B('Brancher les câbles', 'ex-cablage');
      const sw = b.add('cisco-2960', 'SW1', 400, 140), pc1 = b.add('pc', 'PC1', 220, 340), pc2 = b.add('pc', 'PC2', 580, 340);
      b.ip(pc1, '192.168.10.1').ip(pc2, '192.168.10.2');
      void sw;
      return b.p;
    },
    check(p) { return result([linkedItem(p, 'PC1', 'SW1'), linkedItem(p, 'PC2', 'SW1'), pingItem(p, 'PC1', 'PC2')]); },
  },
  {
    id: 'ex-depannage', level: 'Débutant', title: 'Trouver les pannes',
    objective: 'Les trois PC devraient tous communiquer, mais deux erreurs se sont glissées dans le réseau. Trouvez-les et corrigez-les.',
    steps: ['Observez la couleur des câbles.', 'Vérifiez la configuration IP de chaque PC (ipconfig).', 'Corrigez puis testez tous les pings.'],
    hints: ['Un point rouge sur un câble signale un port désactivé (shutdown).', 'Sur SW1 : enable → configure terminal → interface fa0/2 → no shutdown.', 'Comparez les adresses : PC3 n’est pas dans le même réseau que les deux autres. Remplacez 192.168.6.3 par 192.168.5.3.'],
    build() {
      const b = new B('Trouver les pannes', 'ex-depannage');
      const sw = b.add('cisco-2960', 'SW1', 400, 140);
      const pcs = [b.add('pc', 'PC1', 200, 340), b.add('pc', 'PC2', 400, 360), b.add('pc', 'PC3', 600, 340)];
      pcs.forEach((pc, i) => b.link(pc, 'FastEthernet0', sw, `FastEthernet0/${i + 1}`));
      b.ip(pcs[0], '192.168.5.1').ip(pcs[1], '192.168.5.2').ip(pcs[2], '192.168.6.3');
      getPort(sw, 'FastEthernet0/2')!.adminUp = false;
      return b.p;
    },
    check(p) { return result([pingItem(p, 'PC1', 'PC2'), pingItem(p, 'PC1', 'PC3'), pingItem(p, 'PC2', 'PC3')]); },
  },
  {
    id: 'ex-vlan', level: 'Intermédiaire', title: 'Séparer deux services avec des VLAN',
    objective: 'Créez le VLAN 10 « COMPTA » (PC1, PC2) et le VLAN 20 « RH » (PC3, PC4). Les PC d’un même service communiquent, les deux services sont isolés.',
    steps: ['Sur SW1, créez les VLAN 10 et 20 et nommez-les.', 'Placez Fa0/1 et Fa0/2 dans le VLAN 10, Fa0/3 et Fa0/4 dans le VLAN 20.', 'Vérifiez avec show vlan brief, puis testez les pings.'],
    hints: ['Mode configuration : enable puis configure terminal.', 'vlan 10 → name COMPTA → exit, puis vlan 20 → name RH → exit.', 'interface range fa0/1 - 2 → switchport mode access → switchport access vlan 10 (idem pour fa0/3 - 4 avec le VLAN 20).'],
    build() {
      const b = new B('VLAN', 'ex-vlan');
      const sw = b.add('cisco-2960', 'SW1', 420, 130);
      const pcs = [1, 2, 3, 4].map((i) => b.add('pc', `PC${i}`, 150 + (i - 1) * 180, 340));
      pcs.forEach((pc, i) => { b.link(pc, 'FastEthernet0', sw, `FastEthernet0/${i + 1}`); b.ip(pc, `192.168.1.${i + 1}`); });
      b.note(170, 450, 'COMPTA (VLAN 10)').note(540, 450, 'RH (VLAN 20)');
      return b.p;
    },
    check(p) {
      return result([vlanItem(p, 'SW1', 10, 'COMPTA'), vlanItem(p, 'SW1', 20, 'RH'),
        accessItem(p, 'SW1', 'FastEthernet0/1', 10), accessItem(p, 'SW1', 'FastEthernet0/2', 10), accessItem(p, 'SW1', 'FastEthernet0/3', 20), accessItem(p, 'SW1', 'FastEthernet0/4', 20),
        pingItem(p, 'PC1', 'PC2'), pingItem(p, 'PC3', 'PC4'), pingItem(p, 'PC1', 'PC3', false)]);
    },
  },
  {
    id: 'ex-trunk', level: 'Intermédiaire', title: 'Relier deux switchs par un trunk',
    objective: 'Les VLAN 10 et 20 existent sur deux switchs. Configurez les VLAN, les ports d’accès et le lien trunk entre SW1 et SW2.',
    steps: ['Sur chaque switch : créez les VLAN 10 et 20.', 'Fa0/1 → VLAN 10, Fa0/2 → VLAN 20 sur chaque switch.', 'Passez Gi0/1 en mode trunk des deux côtés.'],
    hints: ['Un lien trunk transporte plusieurs VLAN grâce aux étiquettes 802.1Q.', 'Sur chaque switch : interface gi0/1 → switchport mode trunk.', 'Vérifiez avec show interfaces trunk ; le mode simulation montre les trames étiquetées.'],
    build() {
      const b = new B('Trunk', 'ex-trunk');
      const s1 = b.add('cisco-2960', 'SW1', 260, 140), s2 = b.add('cisco-2960', 'SW2', 600, 140);
      const p1 = b.add('pc', 'PC1', 160, 340), p3 = b.add('pc', 'PC3', 340, 340), p2 = b.add('pc', 'PC2', 520, 340), p4 = b.add('pc', 'PC4', 700, 340);
      b.link(s1, 'GigabitEthernet0/1', s2, 'GigabitEthernet0/1');
      b.link(p1, 'FastEthernet0', s1, 'FastEthernet0/1').link(p3, 'FastEthernet0', s1, 'FastEthernet0/2').link(p2, 'FastEthernet0', s2, 'FastEthernet0/1').link(p4, 'FastEthernet0', s2, 'FastEthernet0/2');
      b.ip(p1, '192.168.10.1').ip(p2, '192.168.10.2').ip(p3, '192.168.20.1').ip(p4, '192.168.20.2');
      b.note(130, 450, 'PC1, PC2 : VLAN 10 — PC3, PC4 : VLAN 20');
      return b.p;
    },
    check(p) {
      return result([vlanItem(p, 'SW1', 10), vlanItem(p, 'SW1', 20), vlanItem(p, 'SW2', 10), vlanItem(p, 'SW2', 20),
        accessItem(p, 'SW1', 'FastEthernet0/1', 10), accessItem(p, 'SW1', 'FastEthernet0/2', 20), accessItem(p, 'SW2', 'FastEthernet0/1', 10), accessItem(p, 'SW2', 'FastEthernet0/2', 20),
        trunkItem(p, 'SW1', 'GigabitEthernet0/1'), trunkItem(p, 'SW2', 'GigabitEthernet0/1'), pingItem(p, 'PC1', 'PC2'), pingItem(p, 'PC3', 'PC4')]);
    },
  },
  {
    id: 'ex-passerelle', level: 'Intermédiaire', title: 'Deux réseaux et une passerelle',
    objective: 'PC1 (192.168.1.0/24) et PC2 (192.168.2.0/24) sont dans deux réseaux différents. Configurez le routeur R1 et les passerelles pour qu’ils communiquent.',
    steps: ['Sur R1, donnez une adresse à Gi0/0 (réseau de PC1) et à Gi0/1 (réseau de PC2), puis activez-les.', 'Sur chaque PC, indiquez l’adresse du routeur comme passerelle par défaut.', 'Testez : ping de PC1 vers PC2.'],
    hints: ['Les interfaces d’un routeur Cisco sont désactivées par défaut : pensez à « no shutdown ».', 'R1 : interface g0/0 → ip address 192.168.1.1 255.255.255.0 → no shutdown (idem g0/1 avec 192.168.2.1).', 'Passerelle de PC1 = 192.168.1.1, passerelle de PC2 = 192.168.2.1.'],
    build() {
      const b = new B('Passerelle', 'ex-passerelle');
      const r = b.add('cisco-2911', 'R1', 420, 90), s1 = b.add('cisco-2960', 'SW1', 230, 230), s2 = b.add('cisco-2960', 'SW2', 610, 230);
      const p1 = b.add('pc', 'PC1', 230, 400), p2 = b.add('pc', 'PC2', 610, 400);
      b.link(r, 'GigabitEthernet0/0', s1, 'GigabitEthernet0/1').link(r, 'GigabitEthernet0/1', s2, 'GigabitEthernet0/1').link(p1, 'FastEthernet0', s1, 'FastEthernet0/1').link(p2, 'FastEthernet0', s2, 'FastEthernet0/1');
      b.ip(p1, '192.168.1.10').ip(p2, '192.168.2.10');
      b.note(150, 480, 'Réseau 192.168.1.0/24').note(540, 480, 'Réseau 192.168.2.0/24');
      return b.p;
    },
    check(p) {
      const g1 = dev(p, 'PC1')?.config.host?.gateway ?? '', g2 = dev(p, 'PC2')?.config.host?.gateway ?? '';
      return result([item('PC1 a une passerelle', !!g1, 'Aucune passerelle sur PC1.'), item('PC2 a une passerelle', !!g2, 'Aucune passerelle sur PC2.'),
        pingItem(p, 'PC1', g1 || '0.0.0.0', true, 'PC1 joint sa passerelle'), pingItem(p, 'PC2', g2 || '0.0.0.0', true, 'PC2 joint sa passerelle'), pingItem(p, 'PC1', 'PC2')]);
    },
  },
  {
    id: 'ex-roas', level: 'Avancé', title: 'Routage inter-VLAN (router-on-a-stick)',
    objective: 'Les VLAN 10 et 20 sont prêts sur SW1. Faites communiquer PC1 (VLAN 10) et PC2 (VLAN 20) via des sous-interfaces sur R1.',
    steps: ['SW1 : passez Gi0/1 (vers R1) en mode trunk.', 'R1 : activez Gi0/0 puis créez Gi0/0.10 et Gi0/0.20 avec encapsulation dot1Q.', 'Donnez aux sous-interfaces les adresses des passerelles (192.168.10.1 et 192.168.20.1).'],
    hints: ['Le routeur reçoit des trames étiquetées : chaque sous-interface traite un VLAN.', 'R1 : interface g0/0 → no shutdown → interface g0/0.10 → encapsulation dot1Q 10 → ip address 192.168.10.1 255.255.255.0', 'Répétez pour g0/0.20 (VLAN 20, 192.168.20.1). Sur SW1 : interface gi0/1 → switchport mode trunk.'],
    build() {
      const b = new B('Router-on-a-stick', 'ex-roas');
      const r = b.add('cisco-2911', 'R1', 420, 80), sw = b.add('cisco-2960', 'SW1', 420, 230);
      const p1 = b.add('pc', 'PC1', 260, 400), p2 = b.add('pc', 'PC2', 580, 400);
      b.link(r, 'GigabitEthernet0/0', sw, 'GigabitEthernet0/1').link(p1, 'FastEthernet0', sw, 'FastEthernet0/1').link(p2, 'FastEthernet0', sw, 'FastEthernet0/2');
      b.vlan(sw, 10, 'VENTES').vlan(sw, 20, 'TECH').access(sw, 'FastEthernet0/1', 10).access(sw, 'FastEthernet0/2', 20);
      b.ip(p1, '192.168.10.10', '255.255.255.0', '192.168.10.1').ip(p2, '192.168.20.10', '255.255.255.0', '192.168.20.1');
      return b.p;
    },
    check(p) { return result([trunkItem(p, 'SW1', 'GigabitEthernet0/1'), pingItem(p, 'PC1', '192.168.10.1', true, 'PC1 joint sa passerelle 192.168.10.1'), pingItem(p, 'PC2', '192.168.20.1', true, 'PC2 joint sa passerelle 192.168.20.1'), pingItem(p, 'PC1', 'PC2')]); },
  },
  {
    id: 'ex-dhcp', level: 'Avancé', title: 'Distribuer les adresses avec DHCP',
    objective: 'R1 a déjà l’adresse 192.168.1.1. Configurez un serveur DHCP sur R1 pour que PC1 et PC2 obtiennent automatiquement leur adresse, leur masque et leur passerelle.',
    steps: ['Sur R1 : excluez 192.168.1.1 à 192.168.1.9.', 'Créez un pool DHCP avec le réseau, la passerelle et un DNS.', 'Sur chaque PC : mode DHCP (onglet Configuration IP) ou ipconfig /renew.'],
    hints: ['Commandes Cisco : ip dhcp excluded-address, ip dhcp pool, network, default-router.', 'R1(config)# ip dhcp excluded-address 192.168.1.1 192.168.1.9 → ip dhcp pool LAN → network 192.168.1.0 255.255.255.0 → default-router 192.168.1.1', 'Puis sur PC1 et PC2 : ipconfig /renew. Vérifiez sur R1 : show ip dhcp binding.'],
    build() {
      const b = new B('DHCP', 'ex-dhcp');
      const r = b.add('cisco-2911', 'R1', 420, 90), sw = b.add('cisco-2960', 'SW1', 420, 230);
      const p1 = b.add('pc', 'PC1', 260, 400), p2 = b.add('pc', 'PC2', 580, 400);
      b.link(r, 'GigabitEthernet0/0', sw, 'GigabitEthernet0/1').link(p1, 'FastEthernet0', sw, 'FastEthernet0/1').link(p2, 'FastEthernet0', sw, 'FastEthernet0/2');
      b.rip(r, 'GigabitEthernet0/0', '192.168.1.1');
      for (const pc of [p1, p2]) pc.config.host!.mode = 'dhcp';
      return b.p;
    },
    check(p) {
      const viaDhcp = (n: string) => { const h = dev(p, n)?.config.host; const ok = !!h && h.mode === 'dhcp' && !!h.dhcpServer && inSubnet(h.ip, '192.168.1.0', '255.255.255.0'); return item(`${n} a obtenu une adresse 192.168.1.x par DHCP`, ok, h?.ip?.startsWith('169.254') ? `${n} a une adresse APIPA (${h.ip}) : le serveur DHCP n'a pas répondu.` : `${n} n'a pas encore reçu d'adresse DHCP (essayez ipconfig /renew).`); };
      const gw = (n: string) => item(`${n} a reçu la passerelle 192.168.1.1`, dev(p, n)?.config.host?.gateway === '192.168.1.1', 'Ajoutez « default-router 192.168.1.1 » dans le pool puis renouvelez le bail.');
      return result([viaDhcp('PC1'), viaDhcp('PC2'), gw('PC1'), gw('PC2'), pingItem(p, 'PC1', 'PC2'), pingItem(p, 'PC1', '192.168.1.1', true, 'PC1 joint R1')]);
    },
  },
  {
    id: 'ex-allied', level: 'Avancé', title: 'Réseau mixte Cisco + Allied Telesis',
    objective: 'PC1 est sur un Cisco 2960, PC2 sur un Allied Telesis x230. Mettez-les tous les deux dans le VLAN 30 et transportez ce VLAN sur le trunk entre les switchs.',
    steps: ['Cisco SW1 : VLAN 30, Fa0/1 en accès VLAN 30, Gi0/1 en trunk.', 'Allied Telesis AT-SW1 : vlan database → vlan 30, port1.0.1 en accès VLAN 30.', 'AT-SW1 : port1.0.10 en trunk et autorisez le VLAN 30 sur ce trunk.'],
    hints: ['Les syntaxes diffèrent ! Sur AlliedWare Plus, les VLAN se créent dans « vlan database ».', 'AT-SW1 : enable → configure terminal → vlan database → vlan 30 name SERVICE → exit → interface port1.0.1 → switchport access vlan 30', 'Sur AlliedWare Plus, un trunk n’autorise aucun VLAN étiqueté par défaut : interface port1.0.10 → switchport mode trunk → switchport trunk allowed vlan add 30'],
    build() {
      const b = new B('Cisco + Allied Telesis', 'ex-allied');
      const s1 = b.add('cisco-2960', 'SW1', 260, 150), s2 = b.add('at-x230', 'AT-SW1', 600, 150);
      const p1 = b.add('pc', 'PC1', 260, 360), p2 = b.add('pc', 'PC2', 600, 360);
      b.link(s1, 'GigabitEthernet0/1', s2, 'port1.0.10').link(p1, 'FastEthernet0', s1, 'FastEthernet0/1').link(p2, 'FastEthernet0', s2, 'port1.0.1');
      b.ip(p1, '192.168.30.1').ip(p2, '192.168.30.2');
      b.note(330, 460, 'VLAN 30 de bout en bout');
      return b.p;
    },
    check(p) {
      return result([vlanItem(p, 'SW1', 30), vlanItem(p, 'AT-SW1', 30), accessItem(p, 'SW1', 'FastEthernet0/1', 30), accessItem(p, 'AT-SW1', 'port1.0.1', 30),
        trunkItem(p, 'SW1', 'GigabitEthernet0/1'), trunkItem(p, 'AT-SW1', 'port1.0.10'), pingItem(p, 'PC1', 'PC2')]);
    },
  },
  {
    id: 'ex-acl', level: 'Avancé', title: 'Filtrer avec une ACL',
    objective: 'Le réseau fonctionne. Empêchez PC2 (192.168.1.11) de joindre Serveur1, sans bloquer PC1 ni l’accès de PC2 à sa passerelle.',
    steps: ['Créez une ACL standard sur R1.', 'Appliquez-la au plus près de la destination (interface Gi0/1, en sortie).', 'Testez : PC1 → Serveur1 réussit, PC2 → Serveur1 échoue.'],
    hints: ['Une ACL se termine par un « deny any » implicite : n’oubliez pas d’autoriser le reste.', 'R1(config)# access-list 10 deny host 192.168.1.11 → access-list 10 permit any', 'interface g0/1 → ip access-group 10 out. Vérifiez avec show access-lists.'],
    build() {
      const b = new B('ACL', 'ex-acl');
      const r = b.add('cisco-2911', 'R1', 420, 110), sw = b.add('cisco-2960', 'SW1', 220, 250), srv = b.add('server', 'Serveur1', 640, 260);
      const p1 = b.add('pc', 'PC1', 120, 420), p2 = b.add('pc', 'PC2', 320, 420);
      b.link(r, 'GigabitEthernet0/0', sw, 'GigabitEthernet0/1').link(r, 'GigabitEthernet0/1', srv, 'FastEthernet0').link(p1, 'FastEthernet0', sw, 'FastEthernet0/1').link(p2, 'FastEthernet0', sw, 'FastEthernet0/2');
      b.rip(r, 'GigabitEthernet0/0', '192.168.1.1').rip(r, 'GigabitEthernet0/1', '192.168.2.1');
      b.ip(p1, '192.168.1.10', '255.255.255.0', '192.168.1.1').ip(p2, '192.168.1.11', '255.255.255.0', '192.168.1.1').ip(srv, '192.168.2.100', '255.255.255.0', '192.168.2.1');
      return b.p;
    },
    check(p) { return result([pingItem(p, 'PC1', 'Serveur1'), pingItem(p, 'PC2', 'Serveur1', false), pingItem(p, 'PC2', '192.168.1.1', true, 'PC2 joint toujours sa passerelle')]); },
  },
  {
    id: 'ex-at-vlan', level: 'Intermédiaire', title: 'Allied Telesis : VLAN de service',
    objective: 'Créez le VLAN 30 sur le switch Allied Telesis et placez les deux ordinateurs dans ce VLAN.',
    steps: ['Sur AT-SW1, créez le VLAN 30 dans vlan database.', 'Configurez port1.0.1 et port1.0.2 en accès VLAN 30.', 'Testez le ping entre PC1 et PC2.'],
    hints: ['Utilisez enable puis configure terminal et vlan database.', 'vlan 30 name SERVICE puis exit.', 'interface port1.0.1 → switchport access vlan 30 → exit ; répétez sur port1.0.2.'],
    build() { const b=new B('Allied Telesis : VLAN', 'ex-at-vlan'),sw=b.add('at-x230','AT-SW1',400,140),a=b.add('pc','PC1',220,340),c=b.add('pc','PC2',580,340); b.link(a,'FastEthernet0',sw,'port1.0.1').link(c,'FastEthernet0',sw,'port1.0.2'); b.ip(a,'192.168.30.10').ip(c,'192.168.30.11'); return b.p; },
    check(p) { return result([vlanItem(p,'AT-SW1',30),accessItem(p,'AT-SW1','port1.0.1',30),accessItem(p,'AT-SW1','port1.0.2',30),pingItem(p,'PC1','PC2')]); }
  },
  {
    id: 'ex-at-trunk', level: 'Avancé', title: 'Allied Telesis : trunk et isolation',
    objective: 'Sur deux switches Allied Telesis, faites communiquer les postes du VLAN 10 et ceux du VLAN 20, en maintenant les VLAN isolés.',
    steps: ['Créez les VLAN 10 et 20 sur les deux switches.', 'Sur chacun, placez port1.0.1 en VLAN 10 et port1.0.2 en VLAN 20.', 'Configurez port1.0.10 en trunk et autorisez les deux VLAN.', 'Vérifiez la communication dans chaque VLAN et l’isolation entre VLAN.'],
    hints: ['vlan database → vlan 10 → vlan 20 → exit.', 'interface port1.0.1 → switchport access vlan 10 → exit ; idem port1.0.2 VLAN 20.', 'interface port1.0.10 → switchport mode trunk → switchport trunk allowed vlan add 10,20.'],
    build() { const b=new B('Allied Telesis : trunk','ex-at-trunk'),s1=b.add('at-x230','AT-SW1',250,140),s2=b.add('at-x230','AT-SW2',600,140),a=b.add('pc','PC1',150,340),c=b.add('pc','PC2',520,340),d=b.add('pc','PC3',330,340),e=b.add('pc','PC4',700,340); b.link(s1,'port1.0.10',s2,'port1.0.10').link(a,'FastEthernet0',s1,'port1.0.1').link(c,'FastEthernet0',s2,'port1.0.1').link(d,'FastEthernet0',s1,'port1.0.2').link(e,'FastEthernet0',s2,'port1.0.2'); b.ip(a,'192.168.1.10').ip(c,'192.168.1.11').ip(d,'192.168.1.12').ip(e,'192.168.1.13'); return b.p; },
    check(p) { return result([vlanItem(p,'AT-SW1',10),vlanItem(p,'AT-SW1',20),vlanItem(p,'AT-SW2',10),vlanItem(p,'AT-SW2',20),...['AT-SW1','AT-SW2'].flatMap(sw=>[accessItem(p,sw,'port1.0.1',10),accessItem(p,sw,'port1.0.2',20),trunkItem(p,sw,'port1.0.10')]),pingItem(p,'PC1','PC2'),pingItem(p,'PC3','PC4'),pingItem(p,'PC1','PC3',false)]); }
  },
  {
    id: 'ex-print', level: 'Débutant', title: 'Première impression réseau',
    objective: 'Configurez l’imprimante et envoyez une page de test depuis PC1.',
    steps: ['Donnez à Imprimante1 l’adresse 192.168.1.30 et le masque 255.255.255.0.', 'Sur PC1, ouvrez Impression et envoyez une page à Imprimante1.', 'Vérifiez la file sur Imprimante1.'],
    hints: ['Sélectionnez l’imprimante puis Réseau / IP.', 'Sur PC1, l’impression se trouve dans le menu Plus.', 'La page est simulée, elle n’est pas imprimée physiquement.'],
    build() { const b=new B('Première impression','ex-print'),sw=b.add('cisco-2960','SW1',400,140),pc=b.add('pc','PC1',220,340),pr=b.add('printer','Imprimante1',580,340); b.link(pc,'FastEthernet0',sw,'FastEthernet0/1').link(pr,'FastEthernet0',sw,'FastEthernet0/2'); b.ip(pc,'192.168.1.10'); return b.p; },
    check(p) { const pr=dev(p,'Imprimante1');return result([item('Imprimante1 configurée en 192.168.1.30/24',pr?.config.host?.ip==='192.168.1.30' && pr.config.host.mask==='255.255.255.0'),pingItem(p,'PC1','Imprimante1'),item('Une page de PC1 est dans la file',!!pr?.config.printJobs?.some(j=>j.from==='PC1'),'Envoyez une page depuis PC1.')]); }
  },
  {
    id: 'ex-print-vlan', level: 'Avancé', title: 'Dépannage : imprimante inter-VLAN',
    objective: 'Rétablissez l’accès à une imprimante située dans un autre VLAN, puis envoyez une page de test.',
    steps: ['Le switch L3 possède les VLAN 10 et 20 et leurs interfaces.', 'Corrigez le port de l’imprimante, puis activez le routage sur MLS1.', 'Configurez la passerelle de l’imprimante et envoyez une page depuis PC1.'],
    hints: ['Le port Fa0/2 doit être en VLAN 20.', 'Sur MLS1 : configure terminal → ip routing.', 'La passerelle de l’imprimante est 192.168.20.1.'],
    build() { const b=new B('Imprimante inter-VLAN','ex-print-vlan'),sw=b.add('cisco-3560','MLS1',400,140),pc=b.add('pc','PC1',220,340),pr=b.add('printer','Imprimante1',580,340); b.link(pc,'FastEthernet0',sw,'FastEthernet0/1').link(pr,'FastEthernet0',sw,'FastEthernet0/2'); b.vlan(sw,10,'BUREAU').vlan(sw,20,'IMPRESSION').access(sw,'FastEthernet0/1',10);sw.config.svis!.push({vlan:10,ip:'192.168.10.1',mask:'255.255.255.0',adminUp:true},{vlan:20,ip:'192.168.20.1',mask:'255.255.255.0',adminUp:true}); b.ip(pc,'192.168.10.10','255.255.255.0','192.168.10.1').ip(pr,'192.168.20.30'); return b.p; },
    check(p) { const sw=dev(p,'MLS1'),pr=dev(p,'Imprimante1');return result([accessItem(p,'MLS1','FastEthernet0/2',20),item('Routage activé sur MLS1',sw?.config.ipRouting===true),item('Passerelle de l’imprimante configurée',pr?.config.host?.gateway==='192.168.20.1'),pingItem(p,'PC1','Imprimante1'),item('Une page de PC1 est dans la file',!!pr?.config.printJobs?.some(j=>j.from==='PC1'))]); }
  },

  {
    id:'ex-at-routes', level:'Avancé', title:'Allied Telesis : deux routeurs et routes statiques',
    objective:'Rétablissez la communication entre les deux réseaux en configurant les routes statiques sur AR1 et R1.',
    steps:['Les interfaces sont déjà adressées et actives.', 'Sur AR1, ajoutez une route vers 10.2.2.0/24 via 172.16.0.2.', 'Sur R1, ajoutez une route de retour vers 10.1.1.0/24 via 172.16.0.1.', 'Testez le ping PC1 vers PC2.'],
    hints:['Les deux routeurs doivent connaître le chemin aller et le chemin retour.', 'AR1 : configure terminal → ip route 10.2.2.0/24 172.16.0.2.', 'R1 : configure terminal → ip route 10.1.1.0 255.255.255.0 172.16.0.1.'],
    build() { const b=new B('Routes statiques Cisco et Allied','ex-at-routes'),ar=b.add('at-ar4050s','AR1',280,160),r=b.add('cisco-2911','R1',600,160),a=b.add('pc','PC1',180,360),c=b.add('pc','PC2',700,360); b.link(a,'FastEthernet0',ar,'eth1').link(ar,'eth2',r,'GigabitEthernet0/0').link(r,'GigabitEthernet0/1',c,'FastEthernet0');b.rip(ar,'eth1','10.1.1.1').rip(ar,'eth2','172.16.0.1').rip(r,'GigabitEthernet0/0','172.16.0.2').rip(r,'GigabitEthernet0/1','10.2.2.1');b.ip(a,'10.1.1.2','255.255.255.0','10.1.1.1').ip(c,'10.2.2.2','255.255.255.0','10.2.2.1');return b.p; },
    check(p) {const ar=dev(p,'AR1'),r=dev(p,'R1');return result([item('AR1 : route vers 10.2.2.0/24',!!ar?.config.routes?.some(x=>x.network==='10.2.2.0' && x.mask==='255.255.255.0' && x.nextHop==='172.16.0.2')),item('R1 : route de retour vers 10.1.1.0/24',!!r?.config.routes?.some(x=>x.network==='10.1.1.0' && x.mask==='255.255.255.0' && x.nextHop==='172.16.0.1')),pingItem(p,'PC1','PC2'),pingItem(p,'PC2','PC1')]); }
  },
  {
    id:'ex-print-acl', level:'Avancé', title:'Impression et filtrage inter-réseaux',
    objective:'Autorisez PC1 à accéder à l’imprimante distante tout en empêchant PC2 de la joindre, puis envoyez une page.',
    steps:['Le routage est déjà opérationnel.', 'Créez une ACL standard sur R1 qui bloque PC2 (10.1.1.11) et autorise le reste.', 'Appliquez-la en sortie sur Gi0/1.', 'Envoyez une page depuis PC1 ; PC2 ne doit pas joindre l’imprimante.'],
    hints:['Une ACL standard filtre l’adresse source et se place près de la destination.', 'R1 : access-list 10 deny host 10.1.1.11 puis access-list 10 permit any.', 'interface g0/1 → ip access-group 10 out. L’impression est simulée par un test de connectivité.'],
    build() {const b=new B('Impression et ACL','ex-print-acl'),r=b.add('cisco-2911','R1',420,100),sw=b.add('cisco-2960','SW1',260,250),a=b.add('pc','PC1',150,410),c=b.add('pc','PC2',360,410),pr=b.add('printer','Imprimante1',650,260);b.link(r,'GigabitEthernet0/0',sw,'GigabitEthernet0/1').link(r,'GigabitEthernet0/1',pr,'FastEthernet0').link(a,'FastEthernet0',sw,'FastEthernet0/1').link(c,'FastEthernet0',sw,'FastEthernet0/2');b.rip(r,'GigabitEthernet0/0','10.1.1.1').rip(r,'GigabitEthernet0/1','10.2.2.1');b.ip(a,'10.1.1.10','255.255.255.0','10.1.1.1').ip(c,'10.1.1.11','255.255.255.0','10.1.1.1').ip(pr,'10.2.2.30','255.255.255.0','10.2.2.1');return b.p;},
    check(p) {const pr=dev(p,'Imprimante1');return result([pingItem(p,'PC1','Imprimante1'),pingItem(p,'PC2','Imprimante1',false),pingItem(p,'PC2','10.1.1.1',true,'PC2 joint sa passerelle'),item('Une page de PC1 est dans la file',!!pr?.config.printJobs?.some(j=>j.from==='PC1'))]);}
  },

];

export function getExercise(id: string) { return EXERCISES.find((e) => e.id === id); }

export function exerciseTrack(e: Exercise): 'Cisco' | 'Allied Telesis' | 'Imprimantes' { if (e.id.startsWith('ex-print')) return 'Imprimantes'; if (e.id.startsWith('ex-at-') || e.id === 'ex-allied') return 'Allied Telesis'; return 'Cisco'; }
export function exerciseProgress(ex: Exercise, p: Project): {done:number;total:number;label:string} { if (ex.id === 'ex-depannage') { const sw=dev(p,'SW1'), pc=dev(p,'PC3')?.config.host; const first=dev(p,'PC1')?.config.host, second=dev(p,'PC2')?.config.host; const checks=[!!sw && getPort(sw,'FastEthernet0/2')?.adminUp===true, !!pc && !!first && isIp(pc.ip) && isMask(pc.mask) && isUsableHost(pc.ip,pc.mask) && pc.ip !== first.ip && (!second?.ip || pc.ip !== second.ip) && inSubnet(pc.ip,first.ip,first.mask) && inSubnet(first.ip,pc.ip,pc.mask)]; return {done:checks.filter(Boolean).length,total:2,label:'pannes résolues'}; } const checks=ex.check(p).items; return {done:checks.filter(i=>i.ok).length,total:checks.length,label:'objectifs validés'}; }
