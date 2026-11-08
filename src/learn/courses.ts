// Cours courts et progressifs. Texte : **gras** et `code` sont pris en charge par l'affichage.
export type Block = { t: 'p'; text: string } | { t: 'h'; text: string } | { t: 'ul'; items: string[] } | { t: 'code'; text: string } | { t: 'tip'; text: string };
export interface Course { id: string; num: number; title: string; minutes: number; summary: string; blocks: Block[]; glossary: [string, string][]; practice?: string }

export const COURSES: Course[] = [
  {
    id: 'c1', num: 1, title: 'Comprendre les équipements réseau', minutes: 5, summary: 'PC, switch, routeur, serveur : qui fait quoi ?',
    blocks: [
      { t: 'p', text: 'Un **réseau** relie des machines pour qu’elles échangent des informations. Chaque équipement a un rôle précis.' },
      { t: 'ul', items: ['**PC et serveurs** : les machines qui envoient et reçoivent les données. Un serveur rend un service aux autres (par exemple DHCP).', '**Switch (commutateur)** : relie les machines d’un même réseau local. Il apprend où se trouve chaque machine et transmet les trames au bon port.', '**Routeur** : relie des réseaux différents entre eux et choisit le chemin des paquets.', '**Pare-feu** : filtre le trafic selon des règles (dans Trame, les ACL du routeur jouent ce rôle pour l’instant).', '**Point d’accès Wi-Fi** : relie les appareils sans fil au réseau local (modèle simplifié dans Trame).'] },
      { t: 'tip', text: 'Dans Trame, faites glisser un équipement depuis la bibliothèque à gauche. Chaque fiche indique le modèle simulé et ses limites.' },
    ],
    glossary: [['Trame', 'Unité de données circulant sur un réseau local (niveau 2), avec des adresses MAC.'], ['Paquet', 'Unité de données routée entre réseaux (niveau 3), avec des adresses IP.']],
    practice: 'ex-deux-pc',
  },
  {
    id: 'c2', num: 2, title: 'Relier deux machines', minutes: 5, summary: 'Câbles, ports et état des liens.',
    blocks: [
      { t: 'p', text: 'Un câble Ethernet relie un **port** d’un équipement à un port d’un autre. Le lien n’est **actif** que si les deux ports sont activés.' },
      { t: 'ul', items: ['Point **vert** : port actif.', 'Point **rouge** : port désactivé (commande `shutdown`).', 'Point **gris** : rien n’est branché en face, ou le port d’en face est désactivé.'] },
      { t: 'p', text: 'Sur un switch, chaque port a un nom : `FastEthernet0/1` (abrégé `Fa0/1`) chez Cisco, `port1.0.1` chez Allied Telesis.' },
      { t: 'tip', text: 'Outil Câble (touche C) : cliquez sur un équipement, choisissez le port, puis cliquez sur le second équipement.' },
    ],
    glossary: [['Port', 'Prise réseau d’un équipement.'], ['Lien', 'Connexion entre deux ports par un câble.']],
    practice: 'ex-cablage',
  },
  {
    id: 'c3', num: 3, title: 'Adresses IP et masques', minutes: 8, summary: 'Lire une adresse, savoir si deux machines sont dans le même réseau.',
    blocks: [
      { t: 'p', text: 'Une **adresse IPv4** est composée de 4 nombres de 0 à 255, par exemple `192.168.1.10`. Le **masque** indique quelle partie de l’adresse désigne le réseau.' },
      { t: 'p', text: 'Avec le masque `255.255.255.0` (noté aussi **/24**), les trois premiers nombres désignent le réseau : `192.168.1.10` et `192.168.1.20` sont dans le même réseau `192.168.1.0`.' },
      { t: 'ul', items: ['Même réseau : les machines communiquent directement à travers les switchs.', 'Réseaux différents : il faut un **routeur** et une **passerelle par défaut**.', 'La première adresse (`.0`) désigne le réseau et la dernière (`.255`) sert à la diffusion : on ne les donne pas aux machines.'] },
      { t: 'tip', text: 'Si deux PC n’ont pas le même réseau, le ping échoue et Trame vous explique pourquoi.' },
    ],
    glossary: [['Masque', 'Indique la taille du réseau, ex. 255.255.255.0 = /24.'], ['Passerelle', 'Adresse du routeur qui permet de sortir du réseau local.']],
    practice: 'ex-depannage',
  },
  {
    id: 'c4', num: 4, title: 'Les premières commandes', minutes: 8, summary: 'Modes de commande Cisco et Allied Telesis, ping, ipconfig.',
    blocks: [
      { t: 'p', text: 'Les switchs et routeurs se configurent en ligne de commande. On passe par plusieurs **modes** :' },
      { t: 'code', text: 'Switch>                 mode utilisateur (consultation)\nSwitch> enable\nSwitch#                 mode privilégié\nSwitch# configure terminal\nSwitch(config)#         configuration globale\nSwitch(config)# interface fa0/1\nSwitch(config-if)#      configuration d’une interface' },
      { t: 'ul', items: ['`?` affiche l’aide contextuelle, **Tab** complète la commande, les flèches rappellent l’historique.', 'Les abréviations sont acceptées : `conf t`, `sh ip int br`.', '`show running-config` affiche la configuration en cours ; `copy running-config startup-config` l’enregistre.', 'Sur un PC : `ipconfig` affiche l’adresse, `ping 192.168.1.11` teste la connexion.'] },
      { t: 'p', text: 'Allied Telesis (AlliedWare Plus) utilise des modes semblables (`awplus>`, `awplus#`, `awplus(config)#`), mais certaines commandes diffèrent : les VLAN se créent dans `vlan database` et les adresses s’écrivent en notation CIDR (`192.168.1.2/24`).' },
    ],
    glossary: [['CLI', 'Interface en ligne de commande.'], ['running-config', 'Configuration active en mémoire (perdue au redémarrage si non enregistrée).']],
    practice: 'ex-depannage',
  },
  {
    id: 'c5', num: 5, title: 'Créer un VLAN', minutes: 8, summary: 'Découper un switch en plusieurs réseaux isolés.',
    blocks: [
      { t: 'p', text: 'Un **VLAN** (réseau local virtuel) découpe un switch en plusieurs réseaux séparés. Deux PC dans des VLAN différents ne se voient pas, même branchés sur le même switch.' },
      { t: 'code', text: 'Cisco :\nSwitch(config)# vlan 10\nSwitch(config-vlan)# name COMPTA\n\nAllied Telesis :\nawplus(config)# vlan database\nawplus(config-vlan)# vlan 10 name COMPTA' },
      { t: 'tip', text: 'Vérifiez avec `show vlan brief` (Cisco et Allied Telesis).' },
    ],
    glossary: [['VLAN', 'Réseau virtuel identifié par un numéro de 1 à 4094. Le VLAN 1 existe par défaut.']],
    practice: 'ex-vlan',
  },
  {
    id: 'c6', num: 6, title: 'Configurer des ports : accès et trunk', minutes: 8, summary: 'Ports d’accès, liens trunk 802.1Q, VLAN natif.',
    blocks: [
      { t: 'ul', items: ['**Port d’accès** : appartient à un seul VLAN, on y branche un PC.', '**Port trunk** : transporte plusieurs VLAN entre deux switchs (ou vers un routeur). Chaque trame porte une **étiquette 802.1Q** avec le numéro de VLAN.', '**VLAN natif** : VLAN dont les trames passent sans étiquette sur un trunk (VLAN 1 par défaut).'] },
      { t: 'code', text: 'Cisco :\ninterface fa0/1\n switchport mode access\n switchport access vlan 10\ninterface gi0/1\n switchport mode trunk\n\nAllied Telesis :\ninterface port1.0.1\n switchport access vlan 10\ninterface port1.0.10\n switchport mode trunk\n switchport trunk allowed vlan add 10' },
      { t: 'tip', text: 'Différence importante : sur Cisco, un trunk autorise tous les VLAN par défaut ; sur Allied Telesis, il faut les ajouter avec « allowed vlan add ».' },
    ],
    glossary: [['802.1Q', 'Norme qui ajoute une étiquette VLAN aux trames sur un trunk.']],
    practice: 'ex-trunk',
  },
  {
    id: 'c7', num: 7, title: 'Faire communiquer des réseaux ou des VLAN', minutes: 10, summary: 'Routeur, passerelle, router-on-a-stick.',
    blocks: [
      { t: 'p', text: 'Pour passer d’un réseau à un autre, une machine envoie ses paquets à sa **passerelle par défaut** : l’adresse du routeur dans son réseau. Le routeur consulte sa **table de routage** (`show ip route`) pour choisir l’interface de sortie.' },
      { t: 'p', text: 'Pour router entre VLAN avec un seul câble, on crée des **sous-interfaces** sur le routeur, une par VLAN : c’est le « router-on-a-stick ».' },
      { t: 'code', text: 'interface g0/0\n no shutdown\ninterface g0/0.10\n encapsulation dot1Q 10\n ip address 192.168.10.1 255.255.255.0' },
      { t: 'p', text: 'Pour joindre un réseau qui n’est pas directement relié, on ajoute une **route statique** : `ip route 10.0.0.0 255.0.0.0 192.168.2.2`.' },
    ],
    glossary: [['Table de routage', 'Liste des réseaux connus par le routeur et de la façon de les joindre.'], ['Sous-interface', 'Interface logique créée sur une interface physique (ex. g0/0.10).']],
    practice: 'ex-passerelle',
  },
  {
    id: 'c8', num: 8, title: 'Découvrir DHCP et le routage', minutes: 8, summary: 'Attribuer automatiquement les adresses.',
    blocks: [
      { t: 'p', text: '**DHCP** distribue automatiquement une adresse IP, un masque, une passerelle et un DNS aux machines. Le client diffuse un message (Discover), le serveur répond (Offer), le client confirme (Request) et le serveur valide (Ack).' },
      { t: 'code', text: 'R1(config)# ip dhcp excluded-address 192.168.1.1 192.168.1.9\nR1(config)# ip dhcp pool LAN\nR1(dhcp-config)# network 192.168.1.0 255.255.255.0\nR1(dhcp-config)# default-router 192.168.1.1\nR1(dhcp-config)# dns-server 8.8.8.8' },
      { t: 'ul', items: ['Le serveur DHCP doit être dans le même VLAN que les clients (le relais `ip helper-address` n’est pas encore simulé).', 'Sans réponse, un PC Windows prend une adresse **APIPA** en 169.254.x.x : signe d’un problème DHCP.', 'Le serveur générique de Trame propose aussi un service DHCP dans son onglet « Services ».'] },
      { t: 'tip', text: 'En mode Simulation, choisissez « DHCP » pour voir passer les quatre messages.' },
    ],
    glossary: [['Bail DHCP', 'Adresse prêtée à un client pour une durée donnée.'], ['APIPA', 'Adresse automatique 169.254.x.x utilisée quand DHCP échoue.']],
    practice: 'ex-dhcp',
  },
  {
    id: 'c9', num: 9, title: 'Filtrer le trafic avec une ACL', minutes: 8, summary: 'Les règles de base d’un pare-feu sur un routeur.',
    blocks: [
      { t: 'p', text: 'Une **ACL** (liste de contrôle d’accès) est une liste de règles `permit` (autoriser) ou `deny` (refuser) lues de haut en bas. La première règle qui correspond s’applique. À la fin, une règle invisible refuse tout le reste.' },
      { t: 'ul', items: ['**Standard** (1 à 99) : filtre selon l’adresse source.', '**Étendue** (100 à 199) : filtre selon la source, la destination et le protocole (ip ou icmp dans Trame).', 'On l’applique à une interface, en entrée (`in`) ou en sortie (`out`).'] },
      { t: 'code', text: 'access-list 10 deny host 192.168.1.11\naccess-list 10 permit any\ninterface g0/1\n ip access-group 10 out' },
    ],
    glossary: [['Masque générique (wildcard)', 'Inverse du masque : 0.0.0.255 correspond à un /24.']],
    practice: 'ex-acl',
  },
  {
    id: 'c10', num: 10, title: 'Découvrir le Wi-Fi', minutes: 6, summary: 'Relier un portable au réseau local.',
    blocks: [
      { t: 'p', text: 'Un **point d’accès** relie des appareils sans fil au réseau Ethernet. Il transmet les trames entre le portable et le switch.' },
      { t: 'ul', items: ['Ajoutez un ordinateur Wi-Fi, un point d’accès et un switch.', 'Avec Relier, associez WiFi0 du portable à un port Radio du point d’accès.', 'Reliez Ethernet0 du point d’accès au switch. Configurez les adresses IP, puis testez avec ping.'] },
      { t: 'tip', text: 'Dans cette version, l’association est manuelle et toujours à portée : SSID, mot de passe, interférences et sécurité radio ne sont pas simulés.' },
    ], glossary: [['Point d’accès', 'Équipement faisant le pont entre Wi-Fi et Ethernet.']],
  },
  {
    id: 'c11', num: 11, title: 'Tester des combinés DECT', minutes: 5, summary: 'Base, combinés et test d’appel.',
    blocks: [
      { t: 'p', text: 'Une **base DECT** relie des combinés sans fil. Dans Trame, elle fait aussi office de pont simplifié vers Ethernet.' },
      { t: 'ul', items: ['Ajoutez une base et deux téléphones DECT.', 'Associez chaque port DECT0 à un port DECT libre de la base avec Relier.', 'Dans Configuration IP, donnez aux combinés deux adresses du même réseau ; puis, dans Appel, testez la liaison.'] },
      { t: 'tip', text: 'Le test vérifie la joignabilité IP et joue une sonnerie sur votre appareil. Il ne transmet pas de voix et ne simule ni SIP ni le protocole DECT.' },
    ], glossary: [['DECT', 'Technologie de téléphonie sans fil ; ici représentée par un lien pédagogique simplifié.']],
  }
];
