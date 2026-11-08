// Bibliothèque d'équipements : modèles simulés, ports et limites connues.
import type { DeviceKind, OsKind } from '../model/types';

export interface PortGroup { full: string; short: string; from: number; to: number; speed: string }
export interface DeviceModel {
  id: string;
  label: string;          // nom commercial
  vendor: 'Cisco' | 'Allied Telesis' | 'Générique';
  kind: DeviceKind;
  os?: OsKind;
  osLabel?: string;
  category: 'Ordinateurs' | 'Serveurs' | 'Imprimantes' | 'Switchs' | 'Routeurs' | 'Sécurité' | 'Sans fil';
  available: boolean;
  namePrefix: string;
  summary: string;
  supported: string[];
  limits: string[];
  ports: PortGroup[];
}

export const MODELS: DeviceModel[] = [
  {
    id: 'pc', label: 'PC', vendor: 'Générique', kind: 'pc', os: 'host', osLabel: 'Invite de commandes (style Windows / Packet Tracer)',
    category: 'Ordinateurs', available: true, namePrefix: 'PC',
    summary: 'Poste de travail avec une carte réseau Ethernet.',
    supported: ['Adresse IPv4 statique ou DHCP', 'Passerelle par défaut', 'ipconfig, ping, tracert, arp'],
    limits: ['Le lien web ouvre le navigateur réel, sans passer par le réseau simulé', 'Pas d’IPv6'],
    ports: [{ full: 'FastEthernet', short: 'Fa', from: 0, to: 0, speed: '100 Mb/s' }],
  },
  {
    id: 'server', label: 'Serveur', vendor: 'Générique', kind: 'server', os: 'host', osLabel: 'Invite de commandes (style Windows / Packet Tracer)',
    category: 'Serveurs', available: true, namePrefix: 'Serveur',
    summary: 'Serveur avec service DHCP configurable.',
    supported: ['Adresse IPv4 statique', 'Service DHCP (pool, passerelle, DNS)', 'ipconfig, ping, tracert, arp'],
    limits: ['Services HTTP, DNS, FTP, e-mail : non implémentés', 'Pas d’IPv6'],
    ports: [{ full: 'FastEthernet', short: 'Fa', from: 0, to: 0, speed: '100 Mb/s' }],
  },
  {
    id: 'printer', label: 'Imprimante réseau', vendor: 'Générique', kind: 'printer', os: 'host', osLabel: 'Imprimante pédagogique', category: 'Imprimantes', available: true, namePrefix: 'Imprimante',
    summary: 'Imprimante réseau simulée avec file de travaux.', supported: ['Configuration IPv4 et ping', 'Réception de pages de test depuis un PC joignable'],
    limits: ['Aucune impression physique : la file est simulée', 'Pas de protocole IPP, pilote, PDF ou découverte automatique'],
    ports: [{ full: 'FastEthernet', short: 'Fa', from: 0, to: 0, speed: '100 Mb/s' }],
  },
  {
    id: 'cisco-2960', label: 'Catalyst 2960-24TT', vendor: 'Cisco', kind: 'switch', os: 'ios-switch',
    osLabel: 'Cisco IOS 15.0 (C2960-LANBASEK9) — sous-ensemble', category: 'Switchs', available: true, namePrefix: 'SW',
    summary: 'Switch d’accès de niveau 2 : 24 ports FastEthernet + 2 GigabitEthernet.',
    supported: ['VLAN (création, nom, suppression)', 'Ports d’accès et trunk 802.1Q (allowed / native)', 'shutdown / no shutdown',
      'Interface Vlan (SVI) de gestion + ip default-gateway', 'Table MAC apprise', 'show running-config, vlan brief, ip interface brief, interfaces status/trunk',
      'enable secret, copy running-config startup-config, reload'],
    limits: ['Pas de STP (une boucle est détectée mais pas résolue)', 'DTP non simulé : les ports restent en accès tant que « switchport mode trunk » n’est pas saisi',
      'Pas de VTP, port-security, EtherChannel, SSH, lignes console/vty', 'Pas de routage (switch de niveau 2)'],
    ports: [
      { full: 'FastEthernet0/', short: 'Fa0/', from: 1, to: 24, speed: '100 Mb/s' },
      { full: 'GigabitEthernet0/', short: 'Gi0/', from: 1, to: 2, speed: '1 Gb/s' },
    ],
  },
  {
    id: 'cisco-2911', label: 'ISR 2911', vendor: 'Cisco', kind: 'router', os: 'ios-router',
    osLabel: 'Cisco IOS 15.1 (C2900-UNIVERSALK9) — sous-ensemble', category: 'Routeurs', available: true, namePrefix: 'R',
    summary: 'Routeur à services intégrés : 3 ports GigabitEthernet.',
    supported: ['Adressage des interfaces, shutdown', 'Sous-interfaces 802.1Q (router-on-a-stick)', 'Routes statiques et route par défaut',
      'Serveur DHCP (ip dhcp pool, excluded-address)', 'ACL numérotées standard (1-99) et étendues (100-199, ip/icmp)', 'show ip route, ip interface brief, ip dhcp binding, access-lists, arp'],
    limits: ['Pas de RIP/OSPF/EIGRP', 'Pas de NAT, ip helper-address, ACL nommées', 'Pas de modules WAN/série'],
    ports: [{ full: 'GigabitEthernet0/', short: 'Gi0/', from: 0, to: 2, speed: '1 Gb/s' }],
  },
  {
    id: 'at-x230', label: 'x230-10GP', vendor: 'Allied Telesis', kind: 'switch', os: 'awplus',
    osLabel: 'AlliedWare Plus 5.5 — sous-ensemble', category: 'Switchs', available: true, namePrefix: 'AT-SW',
    summary: 'Switch Allied Telesis de niveau 2 : ports port1.0.1 à port1.0.10.',
    supported: ['vlan database (vlan N name X)', 'switchport mode access / trunk', 'switchport trunk allowed vlan add/remove/all/none, native vlan',
      'Interface vlanN avec adresse IP en notation CIDR', 'show vlan brief, interface brief, ip interface brief, running-config', 'copy running-config startup-config'],
    limits: ['Les 2 ports SFP sont simulés comme des ports cuivre', 'Pas de routage inter-VLAN, STP, EPSR, AMF, LACP',
      'Les messages d’erreur sont proches de ceux d’AlliedWare Plus mais pas garantis à l’identique'],
    ports: [{ full: 'port1.0.', short: 'port1.0.', from: 1, to: 10, speed: '1 Gb/s' }],
  },
  {
    id: 'cisco-2960g', label: 'Catalyst 2960G', vendor: 'Cisco', kind: 'switch', os: 'ios-switch',
    osLabel: 'Cisco IOS — sous-ensemble pédagogique', category: 'Switchs', available: true, namePrefix: 'SW',
    summary: 'Switch d’accès à 24 ports Gigabit Ethernet.', supported: ['VLAN, ports access et trunk', 'CLI IOS, interface de gestion et table MAC'],
    limits: ['Modèle pédagogique, pas une émulation exacte', 'Pas de STP ni de routage de niveau 3'],
    ports: [{ full: 'GigabitEthernet0/', short: 'Gi0/', from: 1, to: 24, speed: '1 Gb/s' }],
  },
  {
    id: 'laptop', label: 'Ordinateur Wi-Fi', vendor: 'Générique', kind: 'pc', os: 'host', category: 'Sans fil', available: true, namePrefix: 'Portable',
    summary: 'Poste sans fil pédagogique à associer à un point d’accès.', supported: ['IP statique et DHCP', 'Ping via une liaison Wi-Fi'],
    limits: ['Association manuelle ; pas de SSID, mot de passe, portée ou interférences'], ports: [{ full: 'WiFi', short: 'WiFi', from: 0, to: 0, speed: 'Wi-Fi' }],
  },
  {
    id: 'dect-base', label: 'Base DECT', vendor: 'Générique', kind: 'ap', os: 'bridge', category: 'Sans fil', available: true, namePrefix: 'Base',
    summary: 'Base pédagogique : relie jusqu’à 8 combinés au réseau Ethernet.', supported: ['Pont réseau simplifié', 'Association manuelle des combinés'],
    limits: ['Pas de protocole DECT réel, de portée ou d’enregistrement téléphonique'], ports: [{ full: 'Ethernet', short: 'Eth', from: 0, to: 0, speed: '1 Gb/s' }, { full: 'DECT', short: 'DECT', from: 1, to: 8, speed: 'Radio DECT' }],
  },
  {
    id: 'dect-phone', label: 'Téléphone DECT', vendor: 'Générique', kind: 'phone', os: 'host', category: 'Sans fil', available: true, namePrefix: 'Téléphone',
    summary: 'Combiné pédagogique à associer à une base DECT.', supported: ['Configuration IP', 'Test d’appel et sonnerie synthétique'],
    limits: ['Pas de voix, SIP, téléphonie réelle ni protocole DECT'], ports: [{ full: 'DECT', short: 'DECT', from: 0, to: 0, speed: 'Radio DECT' }],
  },
  // --- Équipements prévus mais non encore simulés (affichés comme tels) ---
  {
    id: 'cisco-3560', label: 'Catalyst 3560 (L3)', vendor: 'Cisco', kind: 'switch', os: 'ios-switch', osLabel: 'Cisco IOS — sous-ensemble pédagogique', category: 'Switchs', available: true, namePrefix: 'MLS',
    summary: 'Switch de niveau 3 : commutation et routage entre VLAN par interfaces virtuelles.',
    supported: ['VLAN, ports access et trunks 802.1Q', 'Interfaces VLAN, commande ip routing et routage des VLAN directement connectés', 'show ip route et commandes IOS de base'],
    limits: ['Routage statique ou dynamique et interfaces physiques routées non simulés', 'STP, ACL sur SVI et DHCP non simulés'],
    ports: [{ full: 'FastEthernet0/', short: 'Fa0/', from: 1, to: 24, speed: '100 Mb/s' }, { full: 'GigabitEthernet0/', short: 'Gi0/', from: 1, to: 2, speed: '1 Gb/s' }],
  },
  {
    id: 'at-ar4050s', label: 'AR4050S (routage)', vendor: 'Allied Telesis', kind: 'router', os: 'awplus', osLabel: 'AlliedWare Plus — sous-ensemble pédagogique', category: 'Routeurs', available: true, namePrefix: 'AR',
    summary: 'Routeur Allied Telesis : interfaces eth1 et eth2, routage IPv4.',
    supported: ['Commandes AlliedWare Plus de base', 'Interfaces routées eth1 / eth2, adresses CIDR, routes statiques et ping', 'Sauvegarde et redémarrage de la configuration'],
    limits: ['Simulation partielle : ports LAN, VLAN, UTM, pare-feu, NAT, VPN et DHCP non simulés', 'Pas de protocoles de routage dynamique ni IPv6'],
    ports: [{ full: 'eth', short: 'eth', from: 1, to: 2, speed: '1 Gb/s' }],
  },
  {
    id: 'cisco-asa', label: 'ASA 5506-X (maquette)', vendor: 'Cisco', kind: 'firewall', os: 'filter', osLabel: 'Filtrage pédagogique — pas le système ASA', category: 'Sécurité', available: true, namePrefix: 'FW',
    summary: 'Maquette inspirée du Cisco ASA : filtre IPv4 simple entre deux réseaux.',
    supported: ['Deux interfaces IPv4 directement connectées', 'Blocage par adresse source en entrée ; ping et routage entre les deux réseaux'],
    limits: ['Ne reproduit pas ASA/ASDM ni ses commandes ; configuration graphique uniquement', 'Filtrage sans état : pas de NAT, VPN, inspection, TCP/UDP, règles de sécurité ASA ou Internet réel'],
    ports: [{ full: 'GigabitEthernet1/', short: 'Gi1/', from: 1, to: 2, speed: '1 Gb/s' }],
  },
  {
    id: 'ap', label: 'Point d’accès Wi-Fi', vendor: 'Générique', kind: 'ap', os: 'bridge', category: 'Sans fil', available: true, namePrefix: 'AP',
    summary: 'Point d’accès pédagogique reliant des postes Wi-Fi à Ethernet.', supported: ['Pont réseau simplifié : 1 port Ethernet et 8 associations Wi-Fi', 'Ping et DHCP sur le réseau relié'],
    limits: ['Association manuelle : pas de SSID, mot de passe, portée ni interférences', 'Pas de protocole 802.11 réel ni de terminal'],
    ports: [{ full: 'Ethernet', short: 'Eth', from: 0, to: 0, speed: '1 Gb/s' }, { full: 'Radio', short: 'Radio', from: 1, to: 8, speed: 'Wi-Fi' }],
  },
];

export function getModel(id: string): DeviceModel {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Modèle inconnu : ${id}`);
  return m;
}
export function findModel(id: string): DeviceModel | undefined { return MODELS.find((x) => x.id === id); }
