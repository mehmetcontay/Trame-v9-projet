// Interpréteur Cisco IOS (sous-ensemble) pour Catalyst 2960 et ISR 2911.
import type { Port, DeviceConfig, Acl, AclEntry } from '../model/types';
import { BaseShell, Node, k, a, P, parse, tokenize, helpFor, completeFor, parseVlanList, formatVlanList, ShellCtx } from './framework';
import { parseCiscoIf } from './ifnames';
import { getModel } from '../devices/catalog';
import { defaultConfig, defaultPorts, macDotted } from '../devices/factory';
import { getPort } from '../model/project';
import { portState, portUp, sviUp, l3Interfaces, vlanExists, peerPort } from '../sim/topology';
import { ping, routeLookup, routingTable, traceroute } from '../sim/engine';
import { isIp, isMask, inSubnet, maskToPrefix, networkOf, parseIp, isUsableHost } from '../sim/ip';
import { pad, fakeHash, aclEntryText } from './common';

type Mode = 'user' | 'priv' | 'config' | 'config-if' | 'config-if-range' | 'config-subif' | 'config-vlan' | 'dhcp-config';
const SUFFIX: Record<Mode, string> = { user: '>', priv: '#', config: '(config)#', 'config-if': '(config-if)#', 'config-if-range': '(config-if-range)#', 'config-subif': '(config-subif)#', 'config-vlan': '(config-vlan)#', 'dhcp-config': '(dhcp-config)#' };
const RESERVED = [{ id: 1002, name: 'fddi-default' }, { id: 1003, name: 'token-ring-default' }, { id: 1004, name: 'fddinet-default' }, { id: 1005, name: 'trnet-default' }];

const UNSUPPORTED = ['line', 'username', 'ip domain-name', 'ip domain-lookup', 'crypto', 'spanning-tree', 'speed', 'duplex', 'channel-group', 'router', 'ip nat',
  'service', 'logging', 'snmp-server', 'ntp', 'clock', 'vtp', 'ipv6', 'ip helper-address', 'switchport port-security', 'switchport nonegotiate', 'switchport voice',
  'mdix', 'cdp', 'lldp', 'login', 'password', 'transport', 'ip ssh', 'standby', 'ip ospf', 'switchport mode dynamic', 'show cdp', 'show spanning-tree', 'show running-config interface',
  'show etherchannel', 'show port-security', 'debug', 'show ip protocols', 'show flash', 'show users', 'show clock', 'ip access-list', 'show history', 'terminal'];

/** Vrai si la commande ressemble à une commande connue mais non simulée (échec d'analyse à l'index failIdx). */
export function matchesPhrase(toks: string[], phrase: string, failIdx: number): boolean {
  const ws = phrase.split(' ');
  if (failIdx < 0 || failIdx >= ws.length || toks.length <= failIdx) return false;
  for (let i = 0; i <= failIdx; i++) if (!ws[i].startsWith(toks[i].toLowerCase())) return false;
  return true;
}
export function unsupported(list: string[], words: string[], res: { st: string; idx?: number }): boolean {
  if (res.st !== 'invalid' && res.st !== 'ambiguous') return false;
  const idx = res.idx!;
  if (list.some((u) => matchesPhrase(words, u, idx))) return true;
  return words[0]?.toLowerCase() === 'no' && idx >= 1 && list.some((u) => matchesPhrase(words.slice(1), u, idx - 1));
}

export class CiscoShell extends BaseShell {
  mode: Mode = 'user';
  ifs: string[] = [];
  ifKind: 'port' | 'subif' | 'svi' = 'port';
  vlanTargets: number[] = [];
  pool = '';
  awaitingPw = false;
  pwTries = 0;

  constructor(ctx: ShellCtx) { super(ctx); }
  pingMode() { return (this.mode === 'user' || this.mode === 'priv') && !this.masked ? 'ios' as const : null; }
  pingProbe(target: string) { return ping(this.ctx.get(), this.ctx.deviceId, target, this.ctx.rt); }
  get model() { return getModel(this.dev.modelId); }
  get router() { return this.model.os === 'ios-router'; }
  get l3switch() { return this.dev.modelId === 'cisco-3560'; }
  get cfg(): DeviceConfig { return this.dev.config; }

  prompt(): string {
    if (this.awaitingPw) return 'Password: ';
    const d = this.ctx.get().devices.find((x) => x.id === this.ctx.deviceId);
    return (d?.config.hostname ?? 'Switch') + SUFFIX[this.mode];
  }
  banner(): string[] {
    const d = this.ctx.get().devices.find((x) => x.id === this.ctx.deviceId);
    const b = d?.config.banner ? [d.config.banner, ''] : [];
    return [...b, 'Press RETURN to get started.', ''];
  }
  ctrlZ(): string[] {
    if (['user', 'priv'].includes(this.mode)) return [];
    this.mode = 'priv';
    return ['', '%SYS-5-CONFIG_I: Configured from console by console'];
  }
  helpLines(line: string) { return helpFor(this.tree(this.mode), line); }
  completeLine(line: string) { return completeFor(this.tree(this.mode), line); }

  handle(line: string) {
    if (this.awaitingPw) {
      const ok = (this.cfg.enableSecret && line === this.cfg.enableSecret) || (!this.cfg.enableSecret && line === this.cfg.enablePassword);
      if (ok) { this.awaitingPw = false; this.masked = false; this.mode = 'priv'; return; }
      this.pwTries++;
      if (this.pwTries >= 3) { this.awaitingPw = false; this.masked = false; this.print('% Bad secrets', ''); }
      return;
    }
    // Lignes issues d'un « show running-config » collé : commentaires et en-têtes ignorés, comme sur IOS.
    if (/^\s*!/.test(line) || /^\s*(Building configuration|Current configuration)/i.test(line)) return;
    if (/^\s*version\s+\S+\s*$/i.test(line) && this.mode.startsWith('config')) return;
    const toks = tokenize(line);
    if (!toks.length) return;
    const words = toks.map((t) => t.t);
    const res = parse(this.tree(this.mode), words);
    if (res.st === 'ok') { res.node.run!(res.words); return; }
    // Dans un sous-mode, IOS essaie la commande au niveau « configuration globale »
    if (res.st === 'invalid' && res.idx === 0 && this.mode.startsWith('config-') || (res.st === 'invalid' && res.idx === 0 && this.mode === 'dhcp-config')) {
      const r2 = parse(this.tree('config'), words);
      if (r2.st === 'ok') { this.mode = 'config'; r2.node.run!(r2.words); return; }
    }
    if (unsupported(UNSUPPORTED, words, res)) {
      this.hint(`« ${line.trim()} » : commande IOS reconnue mais non prise en charge par cette simulation.`);
      return;
    }
    if (res.st === 'invalid') {
      if (res.idx === 0 && (this.mode === 'user' || this.mode === 'priv')) {
        this.print(`Translating "${words[0]}"...domain server (255.255.255.255)`, '% Unknown command or computer name, or unable to find computer address');
        return;
      }
      this.print(' '.repeat(this.prompt().length + toks[res.idx].pos) + '^', "% Invalid input detected at '^' marker.", '');
    } else if (res.st === 'ambiguous') this.print(`% Ambiguous command: "${line.trim()}"`);
    else this.print('% Incomplete command.', '');
  }

  // ------------------------------------------------------------------ arbres de commandes
  tree(mode: Mode): Node[] {
    const sw = !this.router;
    const exit = (to: Mode) => k('exit', mode === 'config' ? 'Exit from configure mode' : 'Exit from current mode', () => { this.mode = to; });
    const end = k('end', 'Exit to EXEC mode', () => { this.mode = 'priv'; this.print('', '%SYS-5-CONFIG_I: Configured from console by console'); });
    const doCmd = k('do', 'To run exec commands in config mode', [a(P.line('LINE', 'Exec Command'), (w) => this.doExec(w[1]))]);
    switch (mode) {
      case 'user': return [
        k('enable', 'Turn on privileged commands', () => this.enable()),
        k('exit', 'Exit from the EXEC', () => this.logout()),
        k('logout', 'Exit from the EXEC', () => this.logout()),
        k('ping', 'Send echo messages', [a(P.word('WORD', 'Ping destination address or hostname'), (w) => this.ping(w[1]))]),
        k('traceroute', 'Trace route to destination', [a(P.word('WORD', 'Ping destination address or hostname'), (w) => this.trace(w[1]))]),
        k('show', 'Show running system information', this.showNodes(false)),
      ];
      case 'priv': return [
        k('enable', 'Turn on privileged commands', () => {}),
        k('disable', 'Turn off privileged commands', () => { this.mode = 'user'; }),
        k('exit', 'Exit from the EXEC', () => this.logout()),
        k('logout', 'Exit from the EXEC', () => this.logout()),
        k('configure', 'Enter configuration mode', [k('terminal', 'Configure from the terminal', () => { this.mode = 'config'; this.print('Enter configuration commands, one per line.  End with CNTL/Z.'); })]),
        k('copy', 'Copy from one file to another', [k('running-config', 'Copy from current system configuration', [k('startup-config', 'Copy to startup configuration', () => { this.print('Destination filename [startup-config]? ', 'Building configuration...', '[OK]'); this.saveStartup(); })])]),
        k('write', 'Write running configuration to memory, network, or terminal', [k('memory', 'Write to NV memory', () => this.writeMem()), k('erase', 'Erase NV memory', () => this.eraseStartup())], () => this.writeMem()),
        k('erase', 'Erase a filesystem', [k('startup-config', 'Erase contents of configuration memory', () => this.eraseStartup())]),
        k('reload', 'Halt and perform a cold restart', () => this.reload()),
        k('clear', 'Reset functions', [
          ...(sw ? [k('mac', 'MAC forwarding table', [k('address-table', 'MAC forwarding table', [k('dynamic', 'dynamic entry type', () => { delete this.ctx.rt.mac[this.dev.id]; })])])] : []),
          k('arp-cache', 'Clear the entire ARP cache', () => { delete this.ctx.rt.arp[this.dev.id]; }),
        ]),
        k('ping', 'Send echo messages', [a(P.word('WORD', 'Ping destination address or hostname'), (w) => this.ping(w[1]))]),
        k('traceroute', 'Trace route to destination', [a(P.word('WORD', 'Ping destination address or hostname'), (w) => this.trace(w[1]))]),
        k('show', 'Show running system information', this.showNodes(true)),
      ];
      case 'config': return [
        k('hostname', 'Set system\'s network name', [a(P.word('WORD', "This system's network name"), (w) => this.hostname(w[1]))]),
        k('interface', 'Select an interface to configure', this.ifNodes((t) => this.enterIf(t))),
        ...(sw ? [
          k('vlan', 'Vlan commands', [a(P.vlanList('ISL VLAN IDs 1-1005'), (w) => this.enterVlan(w[1]))]),
          k('ip', 'Global IP configuration subcommands', [k('default-gateway', 'Specify default gateway (if not routing IP)', [a(P.ip('IP address of default gateway'), (w) => { this.cfg.defaultGateway = w[2]; })]), ...(this.l3switch ? [k('routing', 'Enable routing between connected VLAN interfaces', () => { this.cfg.ipRouting = true; })] : [])]),
        ] : [
          k('ip', 'Global IP configuration subcommands', [
            k('route', 'Establish static routes', [a(P.ip('Destination prefix'), [a(P.mask('Destination prefix mask'), [
              a(P.ip('Forwarding router\'s address'), (w) => this.addRoute(w[2], w[3], w[4])),
              a({ name: 'WORD', help: 'Exit interface (ex. GigabitEthernet0/1)', test: (t) => /^[a-zA-Z]+\d/.test(t) }, (w) => this.addRoute(w[2], w[3], undefined, w[4])),
            ])])]),
            k('dhcp', 'Configure DHCP server and relay parameters', [
              k('pool', 'Configure DHCP address pools', [a(P.word('WORD', 'Pool name'), (w) => { this.pool = w[3]; const pools = (this.cfg.dhcpPools ??= []); if (!pools.some((x) => x.name === w[3])) pools.push({ name: w[3] }); this.mode = 'dhcp-config'; })]),
              k('excluded-address', 'Prevent DHCP from assigning certain addresses', [a(P.ip('Low IP address'), [a(P.ip('High IP address'), (w) => this.exclude(w[3], w[4]))], (w) => this.exclude(w[3], w[3]))]),
            ]),
            k('routing', 'Enable IP routing', () => {}),
          ]),
          k('access-list', 'Add an access list entry', [a(P.num(1, 199, 'IP access list number'), [a(P.line('LINE', 'permit | deny ...'), (w) => this.acl(w[1], w[2]))])]),
        ]),
        k('enable', 'Modify enable password parameters', [
          k('secret', 'Assign the privileged level secret', [a(P.word('LINE', 'The UNENCRYPTED (cleartext) \'enable\' secret'), (w) => { this.cfg.enableSecret = w[2]; })]),
          k('password', 'Assign the privileged level password', [a(P.word('LINE', 'The UNENCRYPTED (cleartext) \'enable\' password'), (w) => { this.cfg.enablePassword = w[2]; })]),
        ]),
        k('banner', 'Define a login banner', [k('motd', 'Set Message of the Day banner', [a(P.line('LINE', 'c banner-text c, where \'c\' is a delimiting character'), (w) => this.banner_(w[2]))])]),
        k('no', 'Negate a command or set its defaults', this.noGlobal()),
        exit('priv'), end, doCmd,
      ];
      case 'config-vlan': return [
        k('name', 'Ascii name of the VLAN', [a(P.word('WORD', 'The ascii name for the VLAN'), (w) => this.nameVlan(w[1]))]),
        k('no', 'Negate a command or set its defaults', [k('name', 'Ascii name of the VLAN', () => this.nameVlan(null))]),
        exit('config'), end, doCmd,
      ];
      case 'dhcp-config': return [
        k('network', 'Network number and mask', [a(P.ip('Network number in dotted-decimal notation'), [a(P.mask('Network mask'), (w) => { const pl = this.curPool(); if (pl) { pl.network = networkOf(w[1], w[2]); pl.mask = w[2]; } })])]),
        k('default-router', 'Default routers', [a(P.ip('Router\'s IP address'), (w) => { const pl = this.curPool(); if (pl) pl.defaultRouter = w[1]; })]),
        k('dns-server', 'DNS servers', [a(P.ip('Server\'s name or IP address'), (w) => { const pl = this.curPool(); if (pl) pl.dns = w[1]; })]),
        k('no', 'Negate a command or set its defaults', [
          k('network', 'Network number and mask', () => { const pl = this.curPool(); if (pl) { delete pl.network; delete pl.mask; } }),
          k('default-router', 'Default routers', () => { const pl = this.curPool(); if (pl) delete pl.defaultRouter; }),
          k('dns-server', 'DNS servers', () => { const pl = this.curPool(); if (pl) delete pl.dns; }),
        ]),
        exit('config'), end, doCmd,
      ];
      default: return [...this.ifModeNodes(), exit('config'), end, doCmd];
    }
  }

  ifNodes(run: (text: string) => void): Node[] {
    const types: Node[] = [];
    const num = (h: string) => a(P.line(h, 'interface number'), (w) => run(w[w.length - 2] + w[w.length - 1]));
    const hasFa = this.dev.ports.some((p) => p.name.startsWith('FastEthernet'));
    if (hasFa) types.push(k('FastEthernet', 'FastEthernet IEEE 802.3', [num('<0-9>')]));
    types.push(k('GigabitEthernet', 'GigabitEthernet IEEE 802.3z', [num('<0-9>')]));
    if (!this.router) {
      types.push(k('Vlan', 'Catalyst Vlans', [a(P.num(1, 4094, 'Vlan interface number'), (w) => run('Vlan' + w[w.length - 1]))]));
      types.push(k('range', 'interface range command', [a(P.line('LINE', 'ex. FastEthernet0/1 - 5'), (w) => run('range ' + w[w.length - 1]))]));
    }
    types.push(a({ name: 'WORD', help: 'Interface name (ex. fa0/1, g0/0.10)', test: (t) => /^[a-zA-Z]+\d/.test(t), rest: true }, (w) => run(w[w.length - 1])));
    return types;
  }

  noGlobal(): Node[] {
    const sw = !this.router;
    return [
      k('hostname', 'Set system\'s network name', () => { this.cfg.hostname = sw ? 'Switch' : 'Router'; }),
      k('enable', 'Modify enable password parameters', [k('secret', 'Assign the privileged level secret', () => { delete this.cfg.enableSecret; }), k('password', 'Assign the privileged level password', () => { delete this.cfg.enablePassword; })]),
      k('banner', 'Define a login banner', [k('motd', 'Set Message of the Day banner', () => { delete this.cfg.banner; })]),
      ...(sw ? [
        k('vlan', 'Vlan commands', [a(P.vlanList('ISL VLAN IDs 1-1005'), (w) => this.deleteVlans(w[2]))]),
        k('ip', 'Global IP configuration subcommands', [k('default-gateway', 'Specify default gateway (if not routing IP)', () => { delete this.cfg.defaultGateway; }), ...(this.l3switch ? [k('routing', 'Disable routing', () => { this.cfg.ipRouting = false; })] : [])]),
        k('interface', 'Select an interface to configure', [k('Vlan', 'Catalyst Vlans', [a(P.num(1, 4094, 'Vlan interface number'), (w) => { this.cfg.svis = (this.cfg.svis ?? []).filter((s) => s.vlan !== +w[3]); })])]),
      ] : [
        k('ip', 'Global IP configuration subcommands', [
          k('route', 'Establish static routes', [a(P.ip('Destination prefix'), [a(P.mask('Destination prefix mask'), [a(P.word('WORD', 'Forwarding router\'s address or interface'), (w) => this.delRoute(w[3], w[4], w[5]))], (w) => this.delRoute(w[3], w[4]))])]),
          k('dhcp', 'Configure DHCP server and relay parameters', [
            k('pool', 'Configure DHCP address pools', [a(P.word('WORD', 'Pool name'), (w) => { this.cfg.dhcpPools = (this.cfg.dhcpPools ?? []).filter((x) => x.name !== w[4]); })]),
            k('excluded-address', 'Prevent DHCP from assigning certain addresses', [a(P.ip('Low IP address'), [a(P.ip('High IP address'), (w) => this.unexclude(w[4], w[5]))], (w) => this.unexclude(w[4], w[4]))]),
          ]),
        ]),
        k('access-list', 'Add an access list entry', [a(P.num(1, 199, 'IP access list number'), (w) => { this.cfg.acls = (this.cfg.acls ?? []).filter((x) => x.id !== w[2]); })]),
        k('interface', 'Select an interface to configure', [a(P.line('WORD', 'Subinterface (ex. g0/0.10)'), (w) => this.deleteSubif(w[2]))]),
      ]),
    ];
  }

  ifModeNodes(): Node[] {
    const shut = k('shutdown', 'Shutdown the selected interface', () => this.setShutdown(true));
    const desc = k('description', 'Interface specific description', [a(P.line('LINE', 'Up to 240 characters describing this interface'), (w) => this.forTargets((o) => { o.description = w[1]; }))]);
    const noShut = k('shutdown', 'Shutdown the selected interface', () => this.setShutdown(false));
    const noDesc = k('description', 'Interface specific description', () => this.forTargets((o) => { delete o.description; }));
    const ipAddr = k('address', 'Set the IP address of an interface', [a(P.ip('IP address'), [a(P.mask('IP subnet mask'), (w) => this.setIp(w[2], w[3]))])]);
    const accessGroup = k('access-group', 'Specify access control for packets', [a(P.num(1, 199, 'IP access list (standard or extended)'), [k('in', 'inbound packets', (w) => this.setAcl(w[w.length - 2], 'in')), k('out', 'outbound packets', (w) => this.setAcl(w[w.length - 2], 'out'))])]);
    const noAccessGroup = k('access-group', 'Specify access control for packets', [a(P.num(1, 199, 'IP access list (standard or extended)'), [k('in', 'inbound packets', () => this.setAcl(null, 'in')), k('out', 'outbound packets', () => this.setAcl(null, 'out'))])]);
    if (this.ifKind === 'svi') return [
      k('ip', 'Interface Internet Protocol config commands', [ipAddr]), shut, desc,
      k('no', 'Negate a command or set its defaults', [k('ip', 'Interface Internet Protocol config commands', [k('address', 'Set the IP address of an interface', () => this.setIp(null, null))]), noShut, noDesc]),
    ];
    if (this.router) {
      const nodes: Node[] = [k('ip', 'Interface Internet Protocol config commands', [ipAddr, accessGroup]), shut, desc,
        k('no', 'Negate a command or set its defaults', [k('ip', 'Interface Internet Protocol config commands', [k('address', 'Set the IP address of an interface', () => this.setIp(null, null)), noAccessGroup]), noShut, noDesc])];
      if (this.ifKind === 'subif') nodes.push(k('encapsulation', 'Set encapsulation type for an interface', [k('dot1Q', 'IEEE 802.1Q Virtual LAN', [a(P.num(1, 4094, 'IEEE 802.1Q VLAN ID'), (w) => this.encap(+w[2]))])]));
      return nodes;
    }
    // port de switch Catalyst
    const vl = (h: string, f: (v: number) => void) => a(P.num(1, 4094, h), (w) => f(+w[w.length - 1]));
    return [
      k('switchport', 'Set switching mode characteristics', [
        k('mode', 'Set trunking mode of the interface', [
          k('access', 'Set trunking mode to ACCESS unconditionally', () => this.forPorts((pt) => { pt.mode = 'access'; })),
          k('trunk', 'Set trunking mode to TRUNK unconditionally', () => this.forPorts((pt) => { pt.mode = 'trunk'; })),
          k('dynamic', 'Set trunking mode to dynamically negotiate access or trunk mode', [a(P.line('LINE', 'auto | desirable'), () => this.hint('DTP (mode dynamic) n’est pas simulé : utilisez « switchport mode access » ou « switchport mode trunk ».'))]),
        ]),
        k('access', 'Set access mode characteristics of the interface', [k('vlan', 'Set VLAN when interface is in access mode', [vl('VLAN ID of the VLAN when this port is in access mode', (v) => this.accessVlan(v))])]),
        k('trunk', 'Set trunking characteristics of the interface', [
          k('allowed', 'Set allowed VLAN characteristics when interface is in trunking mode', [k('vlan', 'Set allowed VLANs when interface is in trunking mode', [
            a(P.vlanList(), (w) => this.allowed('set', w[4])),
            k('add', 'add VLANs to the current list', [a(P.vlanList(), (w) => this.allowed('add', w[5]))]),
            k('remove', 'remove VLANs from the current list', [a(P.vlanList(), (w) => this.allowed('remove', w[5]))]),
            k('except', 'all VLANs except the following', [a(P.vlanList(), (w) => this.allowed('except', w[5]))]),
            k('all', 'all VLANs', () => this.allowed('all', '')),
            k('none', 'no VLANs', () => this.allowed('none', '')),
          ])]),
          k('native', 'Set trunking native characteristics when interface is in trunking mode', [k('vlan', 'Set native VLAN when interface is in trunking mode', [vl('VLAN ID of the native VLAN when this port is in trunking mode', (v) => this.forPorts((pt) => { pt.nativeVlan = v; }))])]),
        ]),
      ]),
      shut, desc,
      k('no', 'Negate a command or set its defaults', [noShut, noDesc,
        k('switchport', 'Set switching mode characteristics', [
          k('mode', 'Set trunking mode of the interface', () => this.forPorts((pt) => { delete pt.mode; })),
          k('access', 'Set access mode characteristics of the interface', [k('vlan', 'Set VLAN when interface is in access mode', () => this.forPorts((pt) => { pt.accessVlan = 1; }))]),
          k('trunk', 'Set trunking characteristics of the interface', [
            k('allowed', 'Set allowed VLAN characteristics', [k('vlan', 'Set allowed VLANs', () => this.allowed('all', ''))]),
            k('native', 'Set trunking native characteristics', [k('vlan', 'Set native VLAN', () => this.forPorts((pt) => { pt.nativeVlan = 1; }))]),
          ]),
        ]),
      ]),
    ];
  }

  showNodes(priv: boolean): Node[] {
    const sw = !this.router;
    const nodes: Node[] = [
      k('version', 'System hardware and software status', () => this.showVersion()),
      k('ip', 'IP information', [
        k('interface', 'IP interface status and configuration', [k('brief', 'Brief summary of IP status and configuration', () => this.showIpIntBrief())]),
        ...(this.router || this.l3switch ? [k('route', 'IP routing table', () => this.showIpRoute())] : []),
        ...(this.router ? [
          k('dhcp', 'Show items in the DHCP database', [k('binding', 'DHCP address bindings', () => this.showDhcpBinding()), k('pool', 'DHCP pools information', () => this.showDhcpPool())]),
        ] : []),
        k('arp', 'IP ARP table', () => this.showArp()),
      ]),
      k('interfaces', 'Interface status and configuration', [
        ...(sw ? [k('status', 'Show interface line status', () => this.showIntStatus()), k('trunk', 'Show interface trunk information', () => this.showTrunk())] : []),
        a({ name: 'WORD', help: 'Interface name (ex. fa0/1)', test: (t) => /^[a-zA-Z]+/.test(t), rest: true }, (w) => this.showInterface(w[2])),
      ], () => this.showInterface(null)),
      k('arp', 'ARP table', () => this.showArp()),
    ];
    if (sw) {
      nodes.push(k('vlan', 'VTP VLAN status', [k('brief', 'VTP all VLAN status in brief', () => this.showVlan())], () => this.showVlan()));
      nodes.push(k('mac', 'MAC configuration', [k('address-table', 'MAC forwarding table', () => this.showMac())]));
    } else {
      nodes.push(k('access-lists', 'List access lists', () => this.showAcl()));
    }
    if (priv) {
      nodes.push(k('running-config', 'Current operating configuration', () => this.print(...this.renderRun(this.dev.ports, this.cfg, true))));
      nodes.push(k('startup-config', 'Contents of startup configuration', () => {
        if (!this.dev.startup) this.print('startup-config is not present');
        else this.print(...this.renderRun(this.dev.startup.ports, this.dev.startup.config, false));
      }));
    }
    return nodes;
  }

  // ------------------------------------------------------------------ actions
  enable() {
    if (this.cfg.enableSecret || this.cfg.enablePassword) { this.awaitingPw = true; this.masked = true; this.pwTries = 0; return; }
    this.mode = 'priv';
  }
  logout() { this.mode = 'user'; this.print('', `${this.cfg.hostname} con0 is now available`, '', '', '', '', '', 'Press RETURN to get started.', ''); }
  doExec(line: string) {
    const saved = this.mode;
    const res = parse(this.tree('priv'), tokenize(line).map((t) => t.t));
    if (res.st === 'ok' && !['configure', 'exit', 'disable', 'logout', 'enable'].includes(res.words[0])) { res.node.run!(res.words); this.mode = saved; }
    else if (res.st === 'incomplete') this.print('% Incomplete command.');
    else this.print("% Invalid input detected at '^' marker.");
  }
  hostname(h: string) {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(h)) { this.print('% Hostname contains one or more illegal characters.'); return; }
    this.cfg.hostname = h;
  }
  banner_(text: string) {
    const d = text[0];
    const end = text.indexOf(d, 1);
    this.cfg.banner = end > 0 ? text.slice(1, end) : text.slice(1);
  }
  enterIf(text: string) {
    const r = parseCiscoIf(this.dev, text);
    if (r.kind === 'error') { this.print("% Invalid input detected at '^' marker."); return; }
    if (r.kind === 'ports') { this.ifs = r.names; this.ifKind = 'port'; this.mode = text.toLowerCase().startsWith('range') ? 'config-if-range' : 'config-if'; return; }
    if (r.kind === 'svi') {
      const svis = (this.cfg.svis ??= []);
      if (!svis.some((s) => s.vlan === r.vlan)) {
        svis.push({ vlan: r.vlan, adminUp: true });
        svis.sort((x, y) => x.vlan - y.vlan);
        if (sviUp(this.p, this.dev, r.vlan)) this.print(`%LINK-5-CHANGED: Interface Vlan${r.vlan}, changed state to up`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface Vlan${r.vlan}, changed state to up`);
      }
      this.ifs = [`Vlan${r.vlan}`]; this.ifKind = 'svi'; this.mode = 'config-if'; return;
    }
    const subs = (this.cfg.subifs ??= []);
    if (!subs.some((s) => s.name === r.name)) {
      subs.push({ name: r.name, parent: r.parent, adminUp: true });
      if (portUp(this.p, this.dev, r.parent)) this.print(`%LINK-5-CHANGED: Interface ${r.name}, changed state to up`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${r.name}, changed state to up`);
    }
    this.ifs = [r.name]; this.ifKind = 'subif'; this.mode = 'config-subif';
  }
  deleteSubif(text: string) {
    const r = parseCiscoIf(this.dev, text);
    if (r.kind !== 'subif') { this.print('% Physical interfaces cannot be removed'); return; }
    this.cfg.subifs = (this.cfg.subifs ?? []).filter((s) => s.name !== r.name);
  }
  // Applique une modification à chaque cible (port, sous-interface ou SVI)
  forTargets(f: (o: { description?: string; adminUp: boolean }) => void) {
    for (const n of this.ifs) {
      if (this.ifKind === 'port') { const pt = getPort(this.dev, n); if (pt) f(pt); }
      else if (this.ifKind === 'subif') { const s = this.cfg.subifs?.find((x) => x.name === n); if (s) f(s); }
      else { const s = this.cfg.svis?.find((x) => `Vlan${x.vlan}` === n); if (s) f(s); }
    }
  }
  forPorts(f: (p: Port) => void) { for (const n of this.ifs) { const pt = getPort(this.dev, n); if (pt) f(pt); } }

  setShutdown(down: boolean) {
    for (const n of this.ifs) {
      if (this.ifKind === 'port') {
        const pt = getPort(this.dev, n)!;
        const wasUp = portUp(this.p, this.dev, n);
        if (pt.adminUp === !down) continue;
        pt.adminUp = !down;
        if (down) {
          this.print(`%LINK-5-CHANGED: Interface ${n}, changed state to administratively down`);
          if (wasUp) this.print('', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to down`);
        } else if (portUp(this.p, this.dev, n)) {
          this.print('', `%LINK-5-CHANGED: Interface ${n}, changed state to up`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to up`);
        } else if (this.router) this.print('', `%LINK-5-CHANGED: Interface ${n}, changed state to down`);
      } else if (this.ifKind === 'subif') {
        const s = this.cfg.subifs!.find((x) => x.name === n)!;
        if (s.adminUp === !down) continue;
        s.adminUp = !down;
        this.print(down ? `%LINK-5-CHANGED: Interface ${n}, changed state to administratively down` : `%LINK-5-CHANGED: Interface ${n}, changed state to ${portUp(this.p, this.dev, s.parent) ? 'up' : 'down'}`);
      } else {
        const s = this.cfg.svis!.find((x) => `Vlan${x.vlan}` === n)!;
        if (s.adminUp === !down) continue;
        s.adminUp = !down;
        if (down) this.print(`%LINK-5-CHANGED: Interface ${n}, changed state to administratively down`);
        else if (sviUp(this.p, this.dev, s.vlan)) this.print('', `%LINK-5-CHANGED: Interface ${n}, changed state to up`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to up`);
      }
    }
  }
  setIp(ip: string | null, mask: string | null) {
    const n = this.ifs[0];
    if (ip && mask) {
      if (!isUsableHost(ip, mask)) { this.print(`Bad mask /${maskToPrefix(mask)} for address ${ip}`); return; }
      const others = l3Interfaces(this.p, this.dev).filter((i) => i.name !== n && i.ip);
      const clash = others.find((i) => inSubnet(ip, i.ip, i.mask) || inSubnet(i.ip, ip, mask));
      if (clash) { this.print(`% ${networkOf(ip, mask)} overlaps with ${clash.name}`); return; }
    }
    if (this.ifKind === 'port') { const pt = getPort(this.dev, n)!; if (ip) { pt.ip = ip; pt.mask = mask!; } else { delete pt.ip; delete pt.mask; } }
    else if (this.ifKind === 'subif') {
      const s = this.cfg.subifs!.find((x) => x.name === n)!;
      if (ip && s.vlan === undefined) { this.print('', '% Configuring IP routing on a LAN subinterface is only allowed if that', 'subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,', 'or ISL vLAN.', ''); return; }
      if (ip) { s.ip = ip; s.mask = mask!; } else { delete s.ip; delete s.mask; }
    } else { const s = this.cfg.svis!.find((x) => `Vlan${x.vlan}` === n)!; if (ip) { s.ip = ip; s.mask = mask!; } else { delete s.ip; delete s.mask; } }
  }
  setAcl(id: string | null, dir: 'in' | 'out') {
    const key = dir === 'in' ? 'aclIn' : 'aclOut';
    const n = this.ifs[0];
    const o: any = this.ifKind === 'port' ? getPort(this.dev, n) : this.cfg.subifs!.find((x) => x.name === n);
    if (!o) return;
    if (id) o[key] = id; else delete o[key];
  }
  encap(v: number) {
    const s = this.cfg.subifs!.find((x) => x.name === this.ifs[0])!;
    if (this.cfg.subifs!.some((x) => x !== s && x.parent === s.parent && x.vlan === v)) { this.print(`%Configuration of multiple subinterfaces of the same main`, `interface with the same VID (${v}) is not permitted.`); return; }
    s.vlan = v;
  }
  accessVlan(v: number) {
    if (!vlanExists(this.dev, v)) {
      this.print('% Access VLAN does not exist. Creating vlan ' + v);
      this.cfg.vlans!.push({ id: v, name: `VLAN${String(v).padStart(4, '0')}` });
      this.cfg.vlans!.sort((x, y) => x.id - y.id);
    }
    this.forPorts((pt) => { pt.accessVlan = v; });
  }
  allowed(op: 'set' | 'add' | 'remove' | 'except' | 'all' | 'none', list: string) {
    const vs = list ? parseVlanList(list)! : [];
    this.forPorts((pt) => {
      const cur = pt.trunkAllowed === 'all' ? Array.from({ length: 4094 }, (_, i) => i + 1) : [...(pt.trunkAllowed ?? [])];
      let next: number[] | 'all';
      switch (op) {
        case 'set': next = vs; break;
        case 'add': next = [...new Set([...cur, ...vs])]; break;
        case 'remove': next = cur.filter((x) => !vs.includes(x)); break;
        case 'except': next = Array.from({ length: 4094 }, (_, i) => i + 1).filter((x) => !vs.includes(x)); break;
        case 'all': next = 'all'; break;
        default: next = [];
      }
      if (Array.isArray(next) && next.length === 4094) next = 'all';
      pt.trunkAllowed = Array.isArray(next) ? next.sort((x, y) => x - y) : next;
    });
  }
  enterVlan(list: string) {
    const vs = parseVlanList(list)!;
    for (const v of vs) {
      if (v >= 1002 && v <= 1005) { this.print(`Default VLAN ${v} may not have its name changed.`); continue; }
      if (!vlanExists(this.dev, v)) this.cfg.vlans!.push({ id: v, name: `VLAN${String(v).padStart(4, '0')}` });
    }
    this.cfg.vlans!.sort((x, y) => x.id - y.id);
    this.vlanTargets = vs.filter((v) => v < 1002 || v > 1005);
    this.mode = 'config-vlan';
  }
  nameVlan(name: string | null) {
    for (const v of this.vlanTargets) {
      const vl = this.cfg.vlans!.find((x) => x.id === v);
      if (!vl) continue;
      if (v === 1) { this.print('Default VLAN 1 may not have its name changed.'); continue; }
      vl.name = name ?? `VLAN${String(v).padStart(4, '0')}`;
    }
  }
  deleteVlans(list: string) {
    for (const v of parseVlanList(list)!) {
      if (v === 1 || (v >= 1002 && v <= 1005)) { this.print(`%Default VLAN ${v} may not be deleted.`); continue; }
      this.cfg.vlans = this.cfg.vlans!.filter((x) => x.id !== v);
    }
  }
  addRoute(net: string, mask: string, nh?: string, ifName?: string) {
    if (((parseIp(net)! & ~parseIp(mask)!) >>> 0) !== 0) { this.print('%Inconsistent address and mask'); return; }
    let exitIf: string | undefined;
    if (ifName) {
      const r = parseCiscoIf(this.dev, ifName);
      if (r.kind === 'ports') exitIf = r.names[0]; else if (r.kind === 'subif') exitIf = r.name; else { this.print("% Invalid input detected at '^' marker."); return; }
    }
    const routes = (this.cfg.routes ??= []);
    if (routes.some((r) => r.network === net && r.mask === mask && r.nextHop === nh && r.exitIf === exitIf)) return;
    routes.push({ network: net, mask, nextHop: nh, exitIf });
  }
  delRoute(net: string, mask: string, via?: string) {
    this.cfg.routes = (this.cfg.routes ?? []).filter((r) => !(r.network === net && r.mask === mask && (!via || r.nextHop === via || (r.exitIf ?? '').toLowerCase().startsWith(via.toLowerCase().slice(0, 2)))));
  }
  exclude(lo: string, hi: string) { (this.cfg.dhcpExcluded ??= []).push({ start: lo, end: hi }); }
  unexclude(lo: string, hi: string) { this.cfg.dhcpExcluded = (this.cfg.dhcpExcluded ?? []).filter((r) => !(r.start === lo && r.end === hi)); }
  curPool() { return this.cfg.dhcpPools?.find((x) => x.name === this.pool); }

  acl(id: string, rest: string) {
    const num = +id;
    const type: Acl['type'] = num < 100 ? 'standard' : 'extended';
    const t = rest.trim().split(/\s+/);
    const action = t.shift();
    if (action !== 'permit' && action !== 'deny') {
      if (action === 'remark') return;
      this.print("% Invalid input detected at '^' marker."); return;
    }
    const spec = (): { ip: string; wc: string } | null => {
      const x = t.shift();
      if (!x) return null;
      if (x === 'any') return { ip: '0.0.0.0', wc: '255.255.255.255' };
      if (x === 'host') { const ip = t.shift(); return ip && isIp(ip) ? { ip, wc: '0.0.0.0' } : null; }
      if (!isIp(x)) return null;
      if (t[0] && isIp(t[0])) return { ip: x, wc: t.shift()! };
      return type === 'standard' ? { ip: x, wc: '0.0.0.0' } : null;
    };
    let entry: AclEntry;
    if (type === 'standard') {
      const s = spec();
      if (!s || t.length) { this.print("% Invalid input detected at '^' marker."); return; }
      entry = { action, protocol: null, src: s.ip, srcWc: s.wc };
    } else {
      const proto = t.shift();
      if (proto !== 'ip' && proto !== 'icmp') {
        if (['tcp', 'udp'].includes(proto ?? '')) { this.hint('Les ACL tcp/udp ne sont pas encore simulées (seuls ip et icmp le sont).'); return; }
        this.print("% Invalid input detected at '^' marker."); return;
      }
      const s = spec(), d = spec();
      if (!s || !d) { this.print("% Invalid input detected at '^' marker."); return; }
      if (t.length) { this.hint(`Option « ${t.join(' ')} » non prise en charge par la simulation : entrée ignorée.`); return; }
      entry = { action, protocol: proto, src: s.ip, srcWc: s.wc, dst: d.ip, dstWc: d.wc };
    }
    const acls = (this.cfg.acls ??= []);
    let acl = acls.find((x) => x.id === id);
    if (!acl) { acl = { id, type, entries: [] }; acls.push(acl); acls.sort((x, y) => +x.id - +y.id); }
    acl.entries.push(entry);
  }

  saveStartup() { this.dev.startup = structuredClone({ ports: this.dev.ports, config: { ...this.cfg, leases: [] } }); }
  writeMem() { this.print('Building configuration...', '[OK]'); this.saveStartup(); }
  eraseStartup() { this.print('Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', '[OK]', 'Erase of nvram: complete', '%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram'); this.dev.startup = null; }
  reload() {
    const macs = this.dev.ports.map((p) => p.mac);
    const vlans = this.cfg.vlans;
    if (this.dev.startup) { this.dev.ports = structuredClone(this.dev.startup.ports); this.dev.config = structuredClone(this.dev.startup.config); }
    else { this.dev.ports = defaultPorts(this.dev.modelId); this.dev.config = defaultConfig(this.dev.modelId); }
    this.dev.ports.forEach((p, i) => { p.mac = macs[i] ?? p.mac; });
    if (vlans) this.dev.config.vlans = vlans; // vlan.dat est conservé (comme sur un vrai Catalyst)
    delete this.ctx.rt.arp[this.dev.id]; delete this.ctx.rt.mac[this.dev.id];
    this.mode = 'user';
    this.print('Proceed with reload? [confirm]', '%SYS-5-RELOAD: Reload requested by console. Reload Reason: Reload Command.', '',
      `System Bootstrap, Version 15.0(1r)M9, RELEASE SOFTWARE (fc1)`, `Cisco ${this.model.label} (simulé par Trame)`, '', this.dev.startup ? 'Loading startup-config...' : 'No startup-config found: factory defaults loaded.', '', 'Press RETURN to get started!', '');
  }

  // ------------------------------------------------------------------ ping / traceroute
  ping(target: string) {
    if (!isIp(target)) { this.print('% Unrecognized host or address, or protocol not running.', ''); return; }
    const lk = routeLookup(this.p, this.dev, target);
    const arpMissing = lk.ok && !this.ctx.rt.arp[this.dev.id]?.some((x) => x.ip === lk.nextHop) && lk.nextHop !== target ? true : lk.ok && !this.ctx.rt.arp[this.dev.id]?.some((x) => x.ip === lk.nextHop);
    const r = ping(this.p, this.dev.id, target, this.ctx.rt);
    this.print('Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`);
    if (r.success) {
      const local = l3Interfaces(this.p, this.dev).some((i) => i.ip === target);
      const marks = arpMissing && !local ? '.!!!!' : '!!!!!';
      const n = marks.split('!').length - 1;
      this.print(marks, `Success rate is ${n * 20} percent (${n}/5), round-trip min/avg/max = 0/0/1 ms`);
    } else {
      this.print(r.outcome === 'unreachable' ? 'U.U.U' : '.....', 'Success rate is 0 percent (0/5)');
      if (r.reason) this.hint(r.reason);
    }
  }
  trace(target: string) {
    if (!isIp(target)) { this.print('% Unrecognized host or address, or protocol not running.'); return; }
    this.print('Type escape sequence to abort.', `Tracing the route to ${target}`, '');
    const t = traceroute(this.p, this.dev.id, target, this.ctx.rt);
    t.hops.forEach((h, i) => this.print(`  ${String(i + 1).padStart(2)}   ${h.ip ? pad(h.ip, 16) + '0 msec    0 msec    0 msec' : '*    *    *'}`));
    if (t.reason) this.hint(t.reason);
  }

  // ------------------------------------------------------------------ affichages
  stateOf(pt: Port): [string, string] {
    const s = portState(this.p, this.dev, pt.name);
    return s === 'admin-down' ? ['administratively down', 'down'] : s === 'up' ? ['up', 'up'] : ['down', 'down'];
  }
  showIpIntBrief() {
    const rows: string[] = [`${pad('Interface', 23)}${pad('IP-Address', 16)}OK? Method Status                Protocol `];
    const row = (n: string, ip: string | undefined, st: [string, string]) => rows.push(`${pad(n, 23)}${pad(ip || 'unassigned', 16)}YES ${pad(ip ? 'manual' : 'unset', 7)}${pad(st[0], 22)}${st[1]} `);
    for (const pt of this.dev.ports) row(pt.name, pt.ip, this.stateOf(pt));
    for (const s of this.cfg.subifs ?? []) {
      const parent = getPort(this.dev, s.parent)!;
      const st: [string, string] = !s.adminUp ? ['administratively down', 'down'] : this.stateOf(parent);
      row(s.name, s.ip, st);
    }
    for (const s of this.cfg.svis ?? []) row(`Vlan${s.vlan}`, s.ip, !s.adminUp ? ['administratively down', 'down'] : sviUp(this.p, this.dev, s.vlan) ? ['up', 'up'] : ['up', 'down']);
    this.print(...rows);
  }
  showVersion() {
    const sw = !this.router;
    this.print(
      sw ? 'Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)' : 'Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc2)',
      'Technical Support: http://www.cisco.com/techsupport', 'Copyright (c) 1986-2013 by Cisco Systems, Inc.', '',
      `${this.cfg.hostname} uptime is 0 minutes`, sw ? 'System image file is "flash:c2960-lanbasek9-mz.150-2.SE4.bin"' : 'System image file is "flash0:c2900-universalk9-mz.SPA.151-4.M4.bin"', '',
      sw ? 'cisco WS-C2960-24TT-L (PowerPC405) processor with 65536K bytes of memory.' : 'Cisco CISCO2911/K9 (revision 1.0) with 491520K/32768K bytes of memory.',
      sw ? '24 FastEthernet interfaces' : '3 Gigabit Ethernet interfaces', sw ? '2 Gigabit Ethernet interfaces' : '', '',
      `Base ethernet MAC Address       : ${macDotted(this.dev.ports[0].mac)}`, '', 'Configuration register is 0x2102', '');
    this.hint(`Modèle simulé : ${this.model.vendor} ${this.model.label} — ${this.model.osLabel}.`);
  }
  showVlan() {
    const rows = ['', 'VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
    for (const v of [...this.cfg.vlans!, ...RESERVED]) {
      const ports = this.dev.ports.filter((pt) => pt.mode !== 'trunk' && (pt.accessVlan ?? 1) === v.id).map((pt) => pt.short);
      const chunks: string[] = [];
      for (let i = 0; i < ports.length; i += 4) chunks.push(ports.slice(i, i + 4).join(', '));
      rows.push(`${pad(v.id, 5)}${pad(v.name, 33)}${pad('active', 10)}${chunks[0] ?? ''}`);
      for (const c of chunks.slice(1)) rows.push(' '.repeat(48) + c);
    }
    this.print(...rows);
  }
  showIntStatus() {
    const rows = [`${pad('Port', 10)}${pad('Name', 19)}${pad('Status', 13)}${pad('Vlan', 11)}${pad('Duplex', 8)}${pad('Speed', 6)}Type`];
    for (const pt of this.dev.ports) {
      const s = portState(this.p, this.dev, pt.name);
      const st = s === 'admin-down' ? 'disabled' : s === 'up' ? 'connected' : 'notconnect';
      const vlan = pt.mode === 'trunk' ? 'trunk' : vlanExists(this.dev, pt.accessVlan ?? 1) ? String(pt.accessVlan ?? 1) : 'inactive';
      rows.push(`${pad(pt.short, 10)}${pad((pt.description ?? '').slice(0, 18), 19)}${pad(st, 13)}${pad(vlan, 11)}${pad(s === 'up' ? 'a-full' : 'auto', 8)}${pad(s === 'up' ? (pt.name.startsWith('Gig') ? 'a-1000' : 'a-100') : 'auto', 6)}${pt.name.startsWith('Gig') ? '10/100/1000BaseTX' : '10/100BaseTX'}`);
    }
    this.print(...rows);
  }
  showTrunk() {
    const trunks = this.dev.ports.filter((pt) => pt.mode === 'trunk' && portUp(this.p, this.dev, pt.name));
    if (!trunks.length) return;
    const allowed = (pt: Port) => (pt.trunkAllowed === 'all' ? '1-4094' : formatVlanList(pt.trunkAllowed ?? []) || 'none');
    const active = (pt: Port) => formatVlanList(this.cfg.vlans!.map((v) => v.id).filter((v) => pt.trunkAllowed === 'all' || (pt.trunkAllowed ?? []).includes(v))) || 'none';
    this.print(`${pad('Port', 12)}${pad('Mode', 13)}${pad('Encapsulation', 15)}${pad('Status', 14)}Native vlan`);
    trunks.forEach((pt) => this.print(`${pad(pt.short, 12)}${pad('on', 13)}${pad('802.1q', 15)}${pad('trunking', 14)}${pt.nativeVlan ?? 1}`));
    this.print('', `${pad('Port', 12)}Vlans allowed on trunk`); trunks.forEach((pt) => this.print(`${pad(pt.short, 12)}${allowed(pt)}`));
    this.print('', `${pad('Port', 12)}Vlans allowed and active in management domain`); trunks.forEach((pt) => this.print(`${pad(pt.short, 12)}${active(pt)}`));
    this.print('', `${pad('Port', 12)}Vlans in spanning tree forwarding state and not pruned`); trunks.forEach((pt) => this.print(`${pad(pt.short, 12)}${active(pt)}`));
  }
  showMac() {
    const list = (this.ctx.rt.mac[this.dev.id] ?? []).filter((e) => portUp(this.p, this.dev, e.port));
    this.print('          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----');
    list.sort((x, y) => x.vlan - y.vlan).forEach((e) => this.print(`${String(e.vlan).padStart(4)}    ${pad(macDotted(e.mac), 18)}${pad('DYNAMIC', 12)}${getPort(this.dev, e.port)?.short ?? e.port}`));
    this.print('');
  }
  showArp() {
    const own = l3Interfaces(this.p, this.dev).filter((i) => i.up);
    const list = this.ctx.rt.arp[this.dev.id] ?? [];
    this.print(`${pad('Protocol', 10)}${pad('Address', 17)}${pad('Age (min)', 11)}${pad('Hardware Addr', 16)}${pad('Type', 7)}Interface`);
    own.forEach((i) => this.print(`${pad('Internet', 10)}${pad(i.ip, 17)}${pad('-', 11)}${pad(macDotted(i.mac), 16)}${pad('ARPA', 7)}${i.name}`));
    list.filter((e) => !own.some((i) => i.ip === e.ip)).forEach((e) => this.print(`${pad('Internet', 10)}${pad(e.ip, 17)}${pad('0', 11)}${pad(macDotted(e.mac), 16)}${pad('ARPA', 7)}${e.ifName}`));
  }
  showIpRoute() {
    const table = routingTable(this.p, this.dev);
    const def = table.find((r) => r.type === 'S' && r.prefix === 0);
    this.print('Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
      '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
      '       * - candidate default, U - per-user static route, o - ODR', '',
      def ? `Gateway of last resort is ${def.nextHop ?? '0.0.0.0'} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    const sorted = [...table].sort((x, y) => (parseIp(x.network)! - parseIp(y.network)!) || (x.prefix - y.prefix));
    for (const r of sorted) {
      const code = r.type === 'S' && r.prefix === 0 ? 'S*' : r.type;
      if (r.type === 'S') this.print(`${pad(code, 5)}   ${r.network}/${r.prefix} ${r.nextHop ? `[1/0] via ${r.nextHop}` : `is directly connected, ${r.exitIf}`}`);
      else this.print(`${pad(code, 5)}   ${r.network}/${r.prefix} is directly connected, ${r.ifc!.name}`);
    }
    this.print('');
  }
  showDhcpBinding() {
    this.print('IP address       Client-ID/              Lease expiration        Type', '                 Hardware address');
    for (const l of this.cfg.leases ?? []) this.print(`${pad(l.ip, 17)}${pad(macDotted(l.mac).toUpperCase(), 24)}${pad('--', 24)}Automatic`);
  }
  showDhcpPool() {
    for (const pl of this.cfg.dhcpPools ?? []) {
      const used = (this.cfg.leases ?? []).filter((l) => pl.network && inSubnet(l.ip, pl.network, pl.mask!)).length;
      this.print('', `Pool ${pl.name} :`, ` Leased addresses               : ${used}`, ` Network                        : ${pl.network ?? '(non défini)'} ${pl.mask ?? ''}`, ` Default router                 : ${pl.defaultRouter ?? '-'}`, ` DNS server                     : ${pl.dns ?? '-'}`);
    }
  }
  showAcl() {
    for (const acl of this.cfg.acls ?? []) {
      this.print(`${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${acl.id}`);
      acl.entries.forEach((e, i) => this.print(`    ${(i + 1) * 10} ${aclEntryText(acl, e)}`));
    }
  }
  showInterface(name: string | null) {
    const names = name ? (() => { const r = parseCiscoIf(this.dev, name); return r.kind === 'ports' ? r.names : r.kind === 'subif' ? [r.name] : r.kind === 'svi' ? [`Vlan${r.vlan}`] : null; })() : this.dev.ports.map((p) => p.name);
    if (!names) { this.print("% Invalid input detected at '^' marker."); return; }
    for (const n of names) {
      const pt = getPort(this.dev, n);
      if (pt) {
        const [st, pr] = this.stateOf(pt);
        const peer = peerPort(this.p, this.dev, n);
        this.print(`${n} is ${st}, line protocol is ${pr}${!this.router ? ` (${st === 'up' ? 'connected' : st === 'down' ? 'notconnect' : 'disabled'})` : ''}`,
          `  Hardware is ${n.startsWith('Gig') ? 'CN Gigabit Ethernet' : 'Lance'}, address is ${macDotted(pt.mac)} (bia ${macDotted(pt.mac)})`,
          ...(pt.description ? [`  Description: ${pt.description}`] : []),
          ...(pt.ip ? [`  Internet address is ${pt.ip}/${maskToPrefix(pt.mask!)}`] : []),
          `  MTU 1500 bytes, BW ${n.startsWith('Gig') ? '1000000' : '100000'} Kbit, DLY 100 usec,`);
        this.hint(peer ? `Relié à ${peer.dev.name} ${peer.port.short}.` : 'Aucun câble branché. (Compteurs et statistiques non simulés.)');
      } else {
        const s = this.cfg.subifs?.find((x) => x.name === n);
        const v = this.cfg.svis?.find((x) => `Vlan${x.vlan}` === n);
        if (s) this.print(`${n} is ${s.adminUp ? this.stateOf(getPort(this.dev, s.parent)!)[0] : 'administratively down'}`, `  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${s.vlan ?? '(non défini)'}`, ...(s.ip ? [`  Internet address is ${s.ip}/${maskToPrefix(s.mask!)}`] : []));
        else if (v) this.print(`${n} is ${v.adminUp ? 'up' : 'administratively down'}, line protocol is ${sviUp(this.p, this.dev, v.vlan) ? 'up' : 'down'}`, ...(v.ip ? [`  Internet address is ${v.ip}/${maskToPrefix(v.mask!)}`] : []));
        else this.print("% Invalid input detected at '^' marker.");
      }
    }
  }

  renderRun(ports: Port[], c: DeviceConfig, current: boolean): string[] {
    const sw = !this.router;
    const L: string[] = ['!', `version ${sw ? '15.0' : '15.1'}`, 'no service timestamps log datetime msec', 'no service timestamps debug datetime msec', 'no service password-encryption', '!', `hostname ${c.hostname}`, '!'];
    if (c.enableSecret) L.push(`enable secret 5 ${fakeHash(c.enableSecret)}`);
    if (c.enablePassword) L.push(`enable password ${c.enablePassword}`);
    if (c.enableSecret || c.enablePassword) L.push('!');
    if (!sw) {
      for (const r of c.dhcpExcluded ?? []) L.push(`ip dhcp excluded-address ${r.start}${r.end !== r.start ? ' ' + r.end : ''}`);
      if (c.dhcpExcluded?.length) L.push('!');
      for (const pl of c.dhcpPools ?? []) {
        L.push(`ip dhcp pool ${pl.name}`);
        if (pl.network) L.push(` network ${pl.network} ${pl.mask}`);
        if (pl.defaultRouter) L.push(` default-router ${pl.defaultRouter}`);
        if (pl.dns) L.push(` dns-server ${pl.dns}`);
      }
      if (c.dhcpPools?.length) L.push('!');
    } else L.push('!');
    for (const pt of ports) {
      L.push(`interface ${pt.name}`);
      if (pt.description) L.push(` description ${pt.description}`);
      if (sw) {
        if (pt.nativeVlan && pt.nativeVlan !== 1) L.push(` switchport trunk native vlan ${pt.nativeVlan}`);
        if (pt.trunkAllowed !== 'all') L.push(` switchport trunk allowed vlan ${formatVlanList(pt.trunkAllowed ?? []) || 'none'}`);
        if ((pt.accessVlan ?? 1) !== 1) L.push(` switchport access vlan ${pt.accessVlan}`);
        if (pt.mode) L.push(` switchport mode ${pt.mode}`);
      } else {
        L.push(pt.ip ? ` ip address ${pt.ip} ${pt.mask}` : ' no ip address');
        if (pt.aclIn) L.push(` ip access-group ${pt.aclIn} in`);
        if (pt.aclOut) L.push(` ip access-group ${pt.aclOut} out`);
        L.push(' duplex auto', ' speed auto');
      }
      if (!pt.adminUp) L.push(' shutdown');
      L.push('!');
      if (!sw) for (const s of (c.subifs ?? []).filter((x) => x.parent === pt.name)) {
        L.push(`interface ${s.name}`);
        if (s.description) L.push(` description ${s.description}`);
        if (s.vlan !== undefined) L.push(` encapsulation dot1Q ${s.vlan}`);
        L.push(s.ip ? ` ip address ${s.ip} ${s.mask}` : ' no ip address');
        if (s.aclIn) L.push(` ip access-group ${s.aclIn} in`);
        if (s.aclOut) L.push(` ip access-group ${s.aclOut} out`);
        if (!s.adminUp) L.push(' shutdown');
        L.push('!');
      }
    }
    for (const s of c.svis ?? []) {
      L.push(`interface Vlan${s.vlan}`);
      if (s.description) L.push(` description ${s.description}`);
      L.push(s.ip ? ` ip address ${s.ip} ${s.mask}` : ' no ip address');
      if (!s.adminUp) L.push(' shutdown');
      L.push('!');
    }
    if (this.l3switch && c.ipRouting) L.push('ip routing', '!');
    if (sw && c.defaultGateway) L.push(`ip default-gateway ${c.defaultGateway}`, '!');
    if (!sw) {
      L.push('ip classless');
      for (const r of c.routes ?? []) L.push(`ip route ${r.network} ${r.mask} ${r.nextHop ?? r.exitIf}`);
      L.push('!', 'ip flow-export version 9', '!');
      for (const acl of c.acls ?? []) for (const e of acl.entries) L.push(`access-list ${acl.id} ${aclEntryText(acl, e)}`);
      if (c.acls?.length) L.push('!');
    }
    if (c.banner) L.push(`banner motd ^C${c.banner}^C`, '!');
    L.push('line con 0', '!', 'line vty 0 4', ' login', ...(sw ? ['line vty 5 15', ' login'] : []), '!', '!', 'end');
    const body = L.join('\n');
    return current ? ['Building configuration...', '', `Current configuration : ${body.length} bytes`, ...L] : [`Using ${body.length} bytes`, ...L];
  }
}
void isMask;
