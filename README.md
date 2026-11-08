# Trame — simulateur réseau pédagogique

Application web de simulation réseau, dans l’esprit de Packet Tracer : on pose des équipements Cisco et Allied Telesis, on les câble, on les configure en ligne de commande, et un vrai moteur calcule ce qui se passe (ARP, VLAN, trunk 802.1Q, routage, DHCP, ACL). Interface React/TypeScript en français, Tailwind CSS et icônes Lucide, thème clair / sombre.

## Démarrer simplement

Ouvrez directement **index.html** (ou dist/trame.html) dans un navigateur récent. Aucune installation ni connexion internet n’est nécessaire. Activez JavaScript et le son pour la sonnerie.

### Essayer le sans-fil

Dans l’application, Fichier → Importer → `exemples/decouverte-sans-fil.trame.json`. Le portable peut faire un ping vers 192.168.1.2 ; pour tester la sonnerie, sélectionnez Téléphone1, ouvrez Appel, choisissez Téléphone2 puis cliquez sur Tester l’appel. Le son sort de votre ordinateur.

## Pour développer

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm run dev        # http://localhost:5173 (reconstruit à chaque modification)
npm test           # tests du moteur, des CLI, du stockage et des exercices
npm run typecheck  # vérification TypeScript
npm run build      # dist/index.html + dist/trame.html (version autonome)
```

`dist/trame.html` est un fichier unique : on peut l’ouvrir directement dans un navigateur, sans serveur ni connexion internet.

## Fonctionnalités

- **Sans fil pédagogique** : reliez un portable Wi-Fi à un point d’accès par WiFi0 ↔ Radio, puis Ethernet0 au switch ; configurez les IP ou DHCP. Les traits radio sont en pointillés. Reliez les combinés DECT à une base par DECT0 ↔ DECT1/2 ; dans Configuration IP attribuez deux adresses du même réseau puis onglet Appel pour un test avec sonnerie locale. Le test vérifie la connectivité IP (ping), sans voix ni SIP.
- **Alimentation** : chaque équipement peut être allumé ou éteint ; éteint, il ne transmet plus et son terminal est fermé. Son état est conservé à l’export. Modèle simplifié : la configuration est conservée, sans séquence de démarrage réelle.
- **Conception** : bibliothèque (recherche, glisser-déposer ou clic), câblage port à port, notes, clic gauche pour sélectionner ou déplacer un équipement ; tracez un cadre sur le fond pour sélectionner plusieurs éléments ; Maj/Ctrl + clic ou bouton ✓ pour une sélection multiple, déplacement groupé, glisser avec le clic droit pour déplacer le schéma (sur écran tactile, glisser le fond), zoom, duplication, suppression, raccourcis (V, R ou C pour relier, N, F, Suppr, Ctrl+D, Ctrl+S).
- **Terminaux** : un onglet par équipement ; Tab (complétion), `?` (aide contextuelle), ↑/↓ (historique), abréviations (`sh ip int br`), Ctrl+Z, Ctrl+C, Ctrl+L / `cls`, messages d’erreur IOS (`% Invalid input detected at '^' marker.`, `% Incomplete command.`, `% Ambiguous command`), mot de passe masqué, collage multi-lignes. Les ping s’affichent progressivement ; Ctrl+C interrompt la commande. Les délais sont simulés, non mesurés.
- **Interface** : bibliothèque compacte repliable, actions contextuelles, inspecteur d’état et bannière d’exercice repliable. Les formulaires IP non appliqués sont protégés lors d’un changement de sélection, d’onglet ou de projet, et avant les commandes terminal `ipconfig /renew` et `/release`. Une adresse déjà utilisée par un autre équipement déclenche un avertissement à vérifier selon les VLAN.
- **Lien web** : dans l’onglet d’un PC, ouvre une adresse HTTP(S) dans une fenêtre intégrée si le site l’autorise, sinon à l’aide du lien « ouvrir dans un nouvel onglet ». Les restrictions CSP et X-Frame-Options des sites ne peuvent pas être contournées. La connexion ne passe pas par le réseau ni le pare-feu simulés.
- **Simulation** : ping ou requête DHCP rejoués pas à pas (lecture, pause, étape avant/arrière, vitesse), animation des paquets sur les câbles, explication de chaque étape et de la cause d’un échec. Les étapes sont produites par le même moteur que les commandes `ping`. Les équipements ne sont pas déplaçables dans ce mode ; repassez en Conception pour modifier la topologie. Une requête DHCP modifie immédiatement la configuration simulée du client, avant la lecture des étapes.
- **Cours et exercices** : 11 cours courts et 16 exercices progressifs répartis en parcours Cisco, Allied Telesis et imprimantes (débutant → avancé), avec indices, vérification réelle (le moteur est interrogé) et message « Bravo, exercice réussi ! ». L’onglet « Réseaux prêts » propose dix topologies configurées à explorer. La progression est mémorisée dans le navigateur. Le panneau d’un exercice peut être masqué puis rouvert sans recommencer ; en sauvegardant le projet, sa topologie est conservée.
- **Projets** : enregistrement local (IndexedDB), ouverture, suppression, export / import en `.trame.json` (validé à l’import), demande de confirmation avant de perdre des modifications, alerte en quittant la page.

## Équipements simulés

| Équipement | Système | Points principaux |
|---|---|---|
| PC, Serveur | Invite de commandes | IP statique / DHCP, `ipconfig [/all /renew /release]`, `ping [-n]`, `tracert`, `arp -a/-d` ; service DHCP sur le serveur |
| Imprimante réseau | Générique | Adresse IP, ping et file de pages de test simulées et indication visuelle temporaire ; pas d’impression physique |
| Cisco Catalyst 2960G | IOS (sous-ensemble) | 24 ports Gigabit, même moteur VLAN et CLI que le 2960 |
| PC Wi-Fi / point d’accès | Générique | Pont Wi-Fi simplifié vers Ethernet ; ping et DHCP |
| Combiné / base DECT | Générique | Pont radio simplifié ; test d’appel fondé sur IP et sonnerie locale |
| Cisco Catalyst 2960-24TT | IOS 15 (sous-ensemble) | VLAN, access / trunk (allowed, native), SVI + `ip default-gateway`, `interface range`, table MAC, `show vlan/interfaces/trunk/running-config…` |
| Cisco Catalyst 3560 | IOS (sous-ensemble) | Commutateur L3 : VLAN, interfaces VLAN, `ip routing` et routage inter-VLAN entre réseaux directement connectés |
| Allied Telesis AR4050S | AlliedWare Plus (sous-ensemble) | Deux interfaces routées eth1/eth2, adressage IPv4 CIDR et routes statiques |
| Cisco ASA 5506-X (maquette) | Filtre graphique pédagogique | Deux interfaces IPv4 ; filtrage simple par adresse source en entrée |
| Cisco ISR 2911 | IOS 15 (sous-ensemble) | Interfaces, sous-interfaces 802.1Q (router-on-a-stick), routes statiques, serveur DHCP (`ip dhcp pool`, `excluded-address`), ACL standard / étendues (ip, icmp) |
| Allied Telesis x230-10GP | AlliedWare Plus (sous-ensemble) | `vlan database`, ports `port1.0.X`, access / trunk, `native vlan`, adresses en notation CIDR, `show vlan brief`, `show interface brief` |

Communs : `enable`, `configure terminal`, `hostname`, `enable secret/password`, `banner motd`, `shutdown`, `copy running-config startup-config`, `write`, `erase startup-config`, `reload`, `do …`.

La maquette ASA ne reproduit pas le système ni les commandes Cisco ASA : elle permet uniquement de tester un filtrage IPv4 sans état, via son panneau graphique.

## Limites connues

- Pas de STP (une boucle est détectée et signalée, pas résolue), ni DTP, VTP, EtherChannel, port-security.
- Pas de protocoles de routage dynamiques (RIP, OSPF, EIGRP), pas de NAT, pas d’`ip helper-address`, pas d’IPv6.
- ACL : protocoles `ip` et `icmp` uniquement (pas de ports TCP/UDP), ACL numérotées seulement.
- Wi-Fi et DECT simplifiés : association manuelle, sans SSID, mot de passe, portée, interférences ni protocoles radio réels ; pas de téléphonie SIP, d’enregistrement, ni de voix. Le son est généré localement.
- Pas de véritable simulation de pare-feu ASA, ni de services HTTP / DNS. La maquette filtre seulement les adresses source sur des paquets simulés et n’effectue ni inspection avec état, ni NAT, ni VPN, ni filtrage TCP/UDP. Le Catalyst 3560 ne gère que le routage entre VLAN directement connectés : pas de routes statiques, de routage dynamique ni d’ACL sur SVI. L’AR4050S ne simule ni ses ports LAN, ni pare-feu, NAT, VPN ou DHCP.
- Le moteur est déterministe : pas de latence réseau réelle, de perte aléatoire ni de vieillissement ARP / MAC. L’affichage des réponses ping est temporisé pour faciliter la lecture, sans prétendre mesurer une latence réelle.
- Le serveur DHCP simplifié exige un pool et une passerelle valides dans son réseau local ; il n’y a pas de relais DHCP. La détection de conflits IP concerne les destinations joignables au sein du même domaine de niveau 2, pas tous les scénarios réseau possibles.
- Un seul type de câble (auto-MDIX supposé).
- Les sorties des commandes reproduisent fidèlement la structure d’IOS / AlliedWare Plus mais ne sont pas identiques à l’octet près.
- Les projets restent dans le navigateur : effacer les données du site les supprime. Exportez les projets importants.

## Fichiers Packet Tracer (.pkt / .pka)

**Non pris en charge.** Le format est propriétaire et non documenté. Des outils communautaires le décodent, avec une fiabilité variable selon les versions et des questions de licence (rétro-ingénierie). Trame détecte ces fichiers et explique l’alternative : recréer la topologie, puis coller le `show running-config` de chaque équipement dans son terminal Trame (les lignes `!`, `Building configuration…`, `version …` sont ignorées ; les commandes non prises en charge sont signalées).

## Architecture

```
src/
  model/     données du projet (types, opérations, projet d’exemple)
  devices/   catalogue des modèles et création des équipements
  sim/       moteur : IP, couche 2 (VLAN / trunk), routage, ARP, ping, traceroute, DHCP, ACL
  cli/       interpréteurs : framework (arbre de commandes, ?, Tab), Cisco IOS, AlliedWare Plus, PC
  storage/   sérialisation validée, IndexedDB
  learn/     cours et exercices (construction + vérification)
  ui/        interface React (canevas, inspecteur, terminaux, simulation, cours, dialogues)
tests/       tests node:test (moteur, CLI, stockage, exercices)
```

Le moteur et les CLI ne dépendent pas de React : ils sont testés seuls et pourraient servir à une autre interface.

## Pistes pour la suite

1. STP simplifié, puis OSPF en zone unique.
2. NAT/PAT, `ip helper-address` et simulation plus complète du pare-feu.
3. ACL étendues TCP/UDP avec un service web simulé.
4. Annuler / rétablir dans l’éditeur.
5. Plus d’exercices, avec un mode « examen » minuté.
