// Données du projet : structures sérialisables (JSON) sans logique.

export type DeviceKind = 'pc' | 'server' | 'printer' | 'switch' | 'router' | 'firewall' | 'ap' | 'phone';
export type OsKind = 'host' | 'ios-switch' | 'ios-router' | 'awplus' | 'bridge' | 'filter';

export interface Port {
  name: string;          // nom complet : FastEthernet0/1, GigabitEthernet0/0, port1.0.1
  short: string;         // nom court : Fa0/1, Gi0/0, port1.0.1
  mac: string;           // 12 caractères hexadécimaux
  speed: string;
  adminUp: boolean;      // false = shutdown
  description?: string;
  // Ports de commutation (switch)
  mode?: 'access' | 'trunk';
  accessVlan?: number;
  trunkAllowed?: number[] | 'all';
  nativeVlan?: number | null; // null = aucun VLAN natif (AlliedWare Plus "none")
  // Ports routés (routeur)
  ip?: string;
  mask?: string;
  aclIn?: string;
  aclOut?: string;
}

export interface SubInterface {
  name: string;          // GigabitEthernet0/0.10
  parent: string;        // GigabitEthernet0/0
  vlan?: number;         // encapsulation dot1Q
  ip?: string;
  mask?: string;
  adminUp: boolean;
  description?: string;
  aclIn?: string;
  aclOut?: string;
}

export interface Svi { vlan: number; ip?: string; mask?: string; adminUp: boolean; description?: string }
export interface Vlan { id: number; name: string }
export interface StaticRoute { network: string; mask: string; nextHop?: string; exitIf?: string }
export interface DhcpPool { name: string; network?: string; mask?: string; defaultRouter?: string; dns?: string }
export interface DhcpRange { start: string; end: string }
export interface DhcpLease { ip: string; mac: string; clientId: string; clientName: string }
export interface AclEntry {
  action: 'permit' | 'deny';
  protocol: 'ip' | 'icmp' | null; // null pour une ACL standard
  src: string; srcWc: string;
  dst?: string; dstWc?: string;
}
export interface Acl { id: string; type: 'standard' | 'extended'; entries: AclEntry[] }

export interface HostNet {
  mode: 'static' | 'dhcp';
  ip: string; mask: string; gateway: string; dns: string;
  dhcpServer?: string;
}

export interface DhcpService { enabled: boolean; poolStart: string; mask: string; maxUsers: number; gateway: string; dns: string }

export interface DeviceConfig {
  hostname: string;
  vlans?: Vlan[];
  svis?: Svi[];
  subifs?: SubInterface[];
  routes?: StaticRoute[];
  defaultGateway?: string;
  ipRouting?: boolean;
  enableSecret?: string;
  enablePassword?: string;
  banner?: string;
  dhcpPools?: DhcpPool[];
  dhcpExcluded?: DhcpRange[];
  leases?: DhcpLease[];
  acls?: Acl[];
  printJobs?: { from: string; text: string; at: number }[];
  host?: HostNet;
  dhcpService?: DhcpService;
}

export interface Device {
  id: string;
  modelId: string;
  poweredOn?: boolean; // absent dans les anciens projets = allumé
  name: string;          // nom affiché dans la topologie
  x: number;
  y: number;
  ports: Port[];
  config: DeviceConfig;
  startup?: { ports: Port[]; config: DeviceConfig } | null; // startup-config enregistrée
}

export interface LinkEnd { device: string; port: string }
export interface Link { id: string; a: LinkEnd; b: LinkEnd }
export interface Note { id: string; x: number; y: number; text: string; color?: string }

export interface Project {
  format: 'trame-project';
  version: 1;
  id: string;
  name: string;
  devices: Device[];
  links: Link[];
  notes: Note[];
  createdAt: number;
  updatedAt: number;
  exerciseId?: string | null;
}
