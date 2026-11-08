// Interpréteur Allied Telesis AlliedWare Plus (sous-ensemble) pour switch x230.
// Syntaxe propre à AW+ : « vlan database », adresses IP en notation CIDR, ports portX.Y.Z,
// trunk sans VLAN autorisé par défaut (« switchport trunk allowed vlan add »).
import type { Port, DeviceConfig } from '../model/types';
import { BaseShell, Node, k, a, P, parse, tokenize, helpFor, completeFor, parseVlanList, formatVlanList, ShellCtx } from './framework';
import { parseAwIf } from './ifnames';
import { getModel } from '../devices/catalog';
import { defaultConfig, defaultPorts, macDotted } from '../devices/factory';
import { getPort } from '../model/project';
import { portState, portUp, sviUp, l3Interfaces, vlanExists } from '../sim/topology';
import { ping, routingTable } from '../sim/engine';
import { isIp, parseCidr, maskToPrefix, networkOf, inSubnet, isUsableHost } from '../sim/ip';
import { pad } from './common';
import { unsupported } from './cisco';

type Mode = 'user' | 'priv' | 'config' | 'config-if' | 'config-vlan';
const SUFFIX: Record<Mode, string> = { user: '>', priv: '#', config: '(config)#', 'config-if': '(config-if)#', 'config-vlan': '(config-vlan)#' };
const UNSUPPORTED = ['spanning-tree', 'epsr', 'atmf', 'lacp', 'static-channel-group', 'channel-group', 'loop-protection', 'service', 'username', 'ip dhcp-snooping',
  'ip dhcp pool', 'router', 'ipv6', 'snmp-server', 'ntp', 'clock', 'log', 'ip igmp', 'mls', 'lldp', 'platform', 'line', 'show spanning-tree', 'show lldp', 'show system', 'speed', 'duplex', 'switchport voice', 'ip routing', 'debug'];

export class AwPlusShell extends BaseShell {
  mode: Mode = 'user';
  ifs: string[] = [];
  ifKind: 'port' | 'svi' = 'port';
  constructor(ctx: ShellCtx) { super(ctx); }
  pingMode() { return (this.mode === 'user' || this.mode === 'priv') && !this.masked ? 'awplus' as const : null; }
  pingProbe(target: string) { return ping(this.ctx.get(), this.ctx.deviceId, target, this.ctx.rt); }
  get cfg(): DeviceConfig { return this.dev.config; }
  get router() { return getModel(this.dev.modelId).kind === 'router'; }

  prompt(): string {
    const d = this.ctx.get().devices.find((x) => x.id === this.ctx.deviceId);
    return (d?.config.hostname ?? 'awplus') + SUFFIX[this.mode];
  }
  banner(): string[] { return ['', 'awplus login: manager', 'Password: ********', '', 'AlliedWare Plus (TM) 5.5.2 (simulation Trame)', '']; }
  ctrlZ(): string[] { if (this.mode !== 'user' && this.mode !== 'priv') this.mode = 'priv'; return []; }
  helpLines(line: string) { return helpFor(this.tree(this.mode), line); }
  completeLine(line: string) { return completeFor(this.tree(this.mode), line); }

  handle(line: string) {
    if (/^\s*!/.test(line) || /^\s*(Building configuration|Current configuration)/i.test(line)) return;
    const toks = tokenize(line);
    if (!toks.length) return;
    const words = toks.map((t) => t.t);
    const res = parse(this.tree(this.mode), words);
    if (res.st === 'ok') { res.node.run!(res.words); return; }
    if (unsupported(UNSUPPORTED, words, res)) {
      this.hint(`« ${line.trim()} » : commande AlliedWare Plus reconnue mais non prise en charge par cette simulation.`);
      return;
    }
    if (res.st === 'invalid') this.print(' '.repeat(this.prompt().length + toks[res.idx].pos) + '^', "% Invalid input detected at '^' marker.");
    else if (res.st === 'ambiguous') this.print('% Ambiguous command');
    else this.print('% Incomplete command.');
  }

  tree(mode: Mode): Node[] {
    const end = k('end', 'End current mode and change to EXEC mode', () => { this.mode = 'priv'; });
    const exit = (to: Mode) => k('exit', 'End current mode and down to previous mode', () => { this.mode = to; });
    const doCmd = k('do', 'To run exec commands in config mode', [a(P.line('LINE', 'Exec Command'), (w) => this.doExec(w[1]))]);
    switch (mode) {
      case 'user': return [
        k('enable', 'Turn on privileged mode command', () => { this.mode = 'priv'; }),
        k('exit', 'End current mode and down to previous mode', () => this.logout()),
        k('logout', 'Exit from EXEC', () => this.logout()),
        k('ping', 'Send echo messages', [a(P.word('WORD', 'Destination address or hostname'), (w) => this.ping(w[1]))]),
        k('show', 'Show running system information', this.showNodes(false)),
      ];
      case 'priv': return [
        k('enable', 'Turn on privileged mode command', () => {}),
        k('disable', 'Turn off privileged mode command', () => { this.mode = 'user'; }),
        k('exit', 'End current mode and down to previous mode', () => this.logout()),
        k('logout', 'Exit from EXEC', () => this.logout()),
        k('configure', 'Enter configuration mode', [k('terminal', 'Configure from the terminal', () => { this.mode = 'config'; this.print('Enter configuration commands, one per line.  End with CNTL/Z.'); })]),
        k('copy', 'Copy from one file to another', [k('running-config', 'Copy running configuration', [k('startup-config', 'Copy to startup configuration', () => this.save())])]),
        k('write', 'Write running configuration to memory, file or terminal', [k('memory', 'Write to NV memory', () => this.save())], () => this.save()),
        k('erase', 'Erase file', [k('startup-config', 'Erase startup configuration', () => { this.dev.startup = null; this.print('Deleting..', 'Successful operation'); })]),
        k('reboot', 'Halt and perform a cold restart', () => this.reboot()),
        k('reload', 'Halt and perform a cold restart', () => this.reboot()),
        k('ping', 'Send echo messages', [a(P.word('WORD', 'Destination address or hostname'), (w) => this.ping(w[1]))]),
        k('show', 'Show running system information', this.showNodes(true)),
      ];
      case 'config': return [
        k('hostname', 'Set system\'s network name', [a(P.word('WORD', 'This system\'s network name'), (w) => this.hostname(w[1]))]),
        ...(!this.router ? [k('vlan', 'Configure VLAN parameters', [k('database', 'Configure VLAN database', () => { this.mode = 'config-vlan'; })])] : []),
        k('interface', 'Select an interface to configure', [a({ name: 'IFRANGE', help: 'Interface range (ex. port1.0.1, port1.0.1-1.0.4, vlan10)', test: (t) => /^(port|vlan|eth)/i.test(t) }, (w) => this.enterIf(w[1]))]),
        k('ip', 'Internet Protocol (IP)', [k('route', 'Establish static routes', [a(P.cidr('IP destination prefix (e.g. 10.0.0.0/8)'), [a(P.ip('IP gateway address'), (w) => this.route(w[2], w[3], true))])])]),
        k('no', 'Negate a command or set its defaults', [
          k('hostname', 'Set system\'s network name', () => { this.cfg.hostname = 'awplus'; }),
          k('ip', 'Internet Protocol (IP)', [k('route', 'Establish static routes', [a(P.cidr('IP destination prefix'), [a(P.ip('IP gateway address'), (w) => this.route(w[3], w[4], false))])])]),
        ]),
        exit('priv'), end, doCmd,
      ];
      case 'config-vlan': return [
        k('vlan', 'Configure VLAN parameters', [a({ name: '<2-4094>', help: 'VLAN ID or range (ex. 10, 10-20)', test: (t) => parseVlanList(t) !== null }, [
          k('name', 'Ascii name of the VLAN', [a(P.word('WORD', 'The ascii name for the VLAN'), (w) => this.createVlans(w[1], w[3]))]),
          k('state', 'Operational state of the VLAN', [k('enable', 'Enable', (w) => this.createVlans(w[1])), k('disable', 'Disable', () => this.hint('L’état « disable » d’un VLAN n’est pas simulé.'))]),
        ], (w) => this.createVlans(w[1]))]),
        k('no', 'Negate a command or set its defaults', [k('vlan', 'Configure VLAN parameters', [a({ name: '<2-4094>', help: 'VLAN ID or range', test: (t) => parseVlanList(t) !== null }, (w) => this.deleteVlans(w[2]))])]),
        exit('config'), end, doCmd,
      ];
      default: return [...this.ifNodes(), exit('config'), end, doCmd];
    }
  }

  ifNodes(): Node[] {
    const shut = k('shutdown', 'Shutdown the selected interface', () => this.shutdown(true));
    const desc = k('description', 'Interface description', [a(P.line('LINE', 'Description of the interface'), (w) => this.forAll((o) => { o.description = w[1]; }))]);
    if (this.ifKind === 'svi' || this.router) return [
      k('ip', 'Internet Protocol (IP)', [k('address', 'Set the IP address of an interface', [a(P.cidr('IP address with prefix length (e.g. 192.168.1.1/24)'), (w) => this.setIp(w[2]))])]),
      shut, desc,
      k('no', 'Negate a command or set its defaults', [k('ip', 'Internet Protocol (IP)', [k('address', 'Set the IP address of an interface', () => this.setIp(null))]), k('shutdown', 'Shutdown the selected interface', () => this.shutdown(false)), k('description', 'Interface description', () => this.forAll((o) => { delete o.description; }))]),
    ];
    const vl = (h: string, f: (v: number) => void) => a(P.num(1, 4094, h), (w) => f(+w[w.length - 1]));
    return [
      k('switchport', 'Set the switching characteristics of the Layer2 interface', [
        k('mode', 'Set the mode of the Layer2 interface', [
          k('access', 'Set the Layer2 interface as access', () => this.forPorts((pt) => { pt.mode = 'access'; })),
          k('trunk', 'Set the Layer2 interface as trunk', () => this.forPorts((pt) => { pt.mode = 'trunk'; })),
        ]),
        k('access', 'Set the Layer2 interface as access', [k('vlan', 'Set the default VID for the interface', [vl('The default VID for the interface', (v) => this.accessVlan(v))])]),
        k('trunk', 'Set the Layer2 interface as trunk', [
          k('allowed', 'Set the allowed VLAN characteristics', [k('vlan', 'Set the allowed VLANs', [
            k('add', 'Add a VLAN to the Xmit/Tx list', [a(P.vlanList('The VID(s) of the VLAN(s)'), (w) => this.allowed('add', w[5]))]),
            k('remove', 'Remove a VLAN from the Xmit/Tx list', [a(P.vlanList('The VID(s) of the VLAN(s)'), (w) => this.allowed('remove', w[5]))]),
            k('all', 'Allow all VLANs to Xmit/Tx', () => this.allowed('all', '')),
            k('none', 'Allow no VLANs to Xmit/Tx', () => this.allowed('none', '')),
          ])]),
          k('native', 'Set the native VLAN', [k('vlan', 'Set the native VLAN', [vl('The VID of the native VLAN', (v) => this.native(v)), k('none', 'Remove the native VLAN (tagged only)', () => this.native(null))])]),
        ]),
      ]),
      shut, desc,
      k('no', 'Negate a command or set its defaults', [
        k('shutdown', 'Shutdown the selected interface', () => this.shutdown(false)),
        k('description', 'Interface description', () => this.forAll((o) => { delete o.description; })),
        k('switchport', 'Set the switching characteristics', [
          k('access', 'Set the Layer2 interface as access', [k('vlan', 'Set the default VID for the interface', () => this.forPorts((pt) => { pt.accessVlan = 1; }))]),
          k('trunk', 'Set the Layer2 interface as trunk', [k('native', 'Set the native VLAN', [k('vlan', 'Set the native VLAN', () => this.native(1))])]),
        ]),
      ]),
    ];
  }

  showNodes(priv: boolean): Node[] {
    const n: Node[] = [
      k('version', 'Version of the switch software', () => this.showVersion()),
      k('interface', 'Interface status and configuration', [k('brief', 'Brief summary of interface status and configuration', () => this.showIntBrief())]),
      ...(!this.router ? [k('vlan', 'Display VLAN information', [k('brief', 'Display information about all VLANs', () => this.showVlan()), k('all', 'Display information about all VLANs', () => this.showVlan())])] : []),
      k('ip', 'Internet Protocol (IP)', [k('interface', 'IP interface status and configuration', [k('brief', 'Brief summary of IP status and configuration', () => this.showIpIntBrief())]), k('route', 'IP routing table', () => this.showRoute())]),
      k('arp', 'Address Resolution Protocol (ARP)', () => this.showArp()),
      ...(!this.router ? [k('mac', 'MAC address', [k('address-table', 'Display the MAC address table', () => this.showMac())])] : []),
    ];
    if (priv) {
      n.push(k('running-config', 'Current operating configuration', () => this.print(...this.render(this.dev.ports, this.cfg))));
      n.push(k('startup-config', 'Contents of startup configuration', () => this.dev.startup ? this.print(...this.render(this.dev.startup.ports, this.dev.startup.config)) : this.print('% No startup configuration file found')));
    }
    return n;
  }

  logout() { this.mode = 'user'; this.print('', 'awplus login: manager', 'Password: ********', ''); }
  doExec(line: string) {
    const saved = this.mode;
    const res = parse(this.tree('priv'), tokenize(line).map((t) => t.t));
    if (res.st === 'ok' && !['configure', 'exit', 'disable', 'logout'].includes(res.words[0])) { res.node.run!(res.words); this.mode = saved; }
    else this.print("% Invalid input detected at '^' marker.");
  }
  hostname(h: string) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(h)) { this.print('% Invalid hostname'); return; }
    this.cfg.hostname = h;
  }
  enterIf(text: string) {
    const r = parseAwIf(this.dev, text);
    if (r.kind === 'error') { this.print(r.msg === 'invalid' ? "% Invalid input detected at '^' marker." : r.msg); return; }
    if (r.kind === 'svi') {
      if (this.router) { this.print('% VLAN interfaces are not supported in this model.'); return; }
      if (!vlanExists(this.dev, r.vlan)) { this.print(`% VLAN ${r.vlan} does not exist`); return; }
      const svis = (this.cfg.svis ??= []);
      if (!svis.some((s) => s.vlan === r.vlan)) { svis.push({ vlan: r.vlan, adminUp: true }); svis.sort((x, y) => x.vlan - y.vlan); }
      this.ifs = [`vlan${r.vlan}`]; this.ifKind = 'svi';
    } else { this.ifs = r.names; this.ifKind = 'port'; }
    this.mode = 'config-if';
  }
  forPorts(f: (p: Port) => void) { if (this.ifKind !== 'port') return; for (const n of this.ifs) { const pt = getPort(this.dev, n); if (pt) f(pt); } }
  forAll(f: (o: { description?: string; adminUp: boolean }) => void) {
    if (this.ifKind === 'port') this.forPorts(f);
    else { const s = this.cfg.svis?.find((x) => `vlan${x.vlan}` === this.ifs[0]); if (s) f(s); }
  }
  shutdown(down: boolean) { this.forAll((o) => { o.adminUp = !down; }); }
  accessVlan(v: number) {
    if (!vlanExists(this.dev, v)) { this.print(`% VLAN ${v} does not exist`); return; }
    this.forPorts((pt) => {
      if (pt.mode === 'trunk') { this.print(`% ${pt.name} is not an access port`); return; }
      pt.accessVlan = v;
    });
  }
  allowed(op: 'add' | 'remove' | 'all' | 'none', list: string) {
    const vs = list ? parseVlanList(list)! : [];
    if (op === 'add') {
      const missing = vs.filter((v) => !vlanExists(this.dev, v));
      if (missing.length) { this.print(`% VLAN ${missing.join(',')} does not exist`); return; }
    }
    this.forPorts((pt) => {
      if (pt.mode !== 'trunk') { this.print(`% ${pt.name} is not a trunk port`); return; }
      const cur = pt.trunkAllowed === 'all' ? this.cfg.vlans!.map((v) => v.id) : [...(pt.trunkAllowed ?? [])];
      pt.trunkAllowed = op === 'all' ? 'all' : op === 'none' ? [] : op === 'add' ? [...new Set([...cur, ...vs])].sort((x, y) => x - y) : cur.filter((x) => !vs.includes(x));
    });
  }
  native(v: number | null) {
    if (v !== null && !vlanExists(this.dev, v)) { this.print(`% VLAN ${v} does not exist`); return; }
    this.forPorts((pt) => {
      if (pt.mode !== 'trunk') { this.print(`% ${pt.name} is not a trunk port`); return; }
      pt.nativeVlan = v;
    });
  }
  createVlans(list: string, name?: string) {
    const vs = parseVlanList(list)!;
    if (vs.includes(1) && name) { this.print('% Default VLAN 1 name cannot be changed'); return; }
    for (const v of vs) {
      const ex = this.cfg.vlans!.find((x) => x.id === v);
      if (ex) { if (name) ex.name = name; }
      else this.cfg.vlans!.push({ id: v, name: name ?? `VLAN${String(v).padStart(4, '0')}` });
    }
    this.cfg.vlans!.sort((x, y) => x.id - y.id);
  }
  deleteVlans(list: string) {
    for (const v of parseVlanList(list)!) {
      if (v === 1) { this.print('% Default VLAN 1 cannot be deleted'); continue; }
      this.cfg.vlans = this.cfg.vlans!.filter((x) => x.id !== v);
      // AW+ remet les ports d'accès de ce VLAN dans le VLAN 1 et retire le VLAN des trunks
      for (const pt of this.dev.ports) {
        if (pt.accessVlan === v) pt.accessVlan = 1;
        if (Array.isArray(pt.trunkAllowed)) pt.trunkAllowed = pt.trunkAllowed.filter((x) => x !== v);
      }
      this.cfg.svis = (this.cfg.svis ?? []).filter((s) => s.vlan !== v);
    }
  }
  setIp(cidr: string | null) {
    const s = this.router ? getPort(this.dev, this.ifs[0])! : this.cfg.svis!.find((x) => `vlan${x.vlan}` === this.ifs[0])!;
    if (!cidr) { delete s.ip; delete s.mask; return; }
    const c = parseCidr(cidr)!;
    if (!isUsableHost(c.ip, c.mask)) { this.print('% Invalid IP address'); return; }
    const clash = l3Interfaces(this.p, this.dev).find((i) => i.name !== this.ifs[0] && i.ip && (inSubnet(c.ip, i.ip, i.mask) || inSubnet(i.ip, c.ip, c.mask)));
    if (clash) { this.print(`% The new IP address ${cidr} overlaps with ${clash.name}`); return; }
    s.ip = c.ip; s.mask = c.mask;
  }
  route(cidr: string, gw: string, add: boolean) {
    const c = parseCidr(cidr)!;
    const net = networkOf(c.ip, c.mask);
    const routes = (this.cfg.routes ??= []);
    if (add) { if (!routes.some((r) => r.network === net && r.mask === c.mask && r.nextHop === gw)) routes.push({ network: net, mask: c.mask, nextHop: gw }); }
    else this.cfg.routes = routes.filter((r) => !(r.network === net && r.mask === c.mask && r.nextHop === gw));
  }
  save() { this.print('Building configuration...', '[OK]'); this.dev.startup = structuredClone({ ports: this.dev.ports, config: this.cfg }); }
  reboot() {
    const macs = this.dev.ports.map((p) => p.mac);
    if (this.dev.startup) { this.dev.ports = structuredClone(this.dev.startup.ports); this.dev.config = structuredClone(this.dev.startup.config); }
    else { this.dev.ports = defaultPorts(this.dev.modelId); this.dev.config = defaultConfig(this.dev.modelId); }
    this.dev.ports.forEach((p, i) => { p.mac = macs[i] ?? p.mac; });
    delete this.ctx.rt.arp[this.dev.id]; delete this.ctx.rt.mac[this.dev.id];
    this.mode = 'user';
    this.print('reboot system? (y/n): y', '', 'Restarting system.', '', 'Bootloader 5.0.x loaded', `Loading simulated ${getModel(this.dev.modelId).label} configuration...`, this.dev.startup ? 'Executing configuration script <flash:/default.cfg>' : 'No startup configuration: factory defaults', '', 'awplus login: manager', 'Password: ********', '');
  }

  ping(target: string) {
    if (!isIp(target)) { this.print(`ping: unknown host ${target}`); return; }
    const r = ping(this.p, this.dev.id, target, this.ctx.rt);
    this.print(`PING ${target} (${target}) 56(84) bytes of data.`);
    if (r.success) for (let i = 1; i <= 5; i++) this.print(`64 bytes from ${target}: icmp_seq=${i} ttl=${r.ttl} time=0.${3 + i} ms`);
    else if (r.outcome === 'unreachable' && r.replyFrom) for (let i = 1; i <= 5; i++) this.print(`From ${r.replyFrom} icmp_seq=${i} Destination Host Unreachable`);
    this.print('', `--- ${target} ping statistics ---`, `5 packets transmitted, ${r.success ? 5 : 0} received, ${r.success ? '' : (r.outcome === 'unreachable' ? '+5 errors, ' : '')}${r.success ? 0 : 100}% packet loss, time 4005ms`);
    if (!r.success && r.reason) this.hint(r.reason);
  }

  showVersion() {
    this.print('AlliedWare Plus (simulation pédagogique)', '', `Platform  : ${getModel(this.dev.modelId).label}`, `Base MAC  : ${macDotted(this.dev.ports[0].mac)}`);
    this.hint('Sous-ensemble de commandes AlliedWare Plus simulé.');
  }
  pstate(pt: Port): [string, string] {
    const s = portState(this.p, this.dev, pt.name);
    return [s === 'admin-down' ? 'admin down' : 'admin up', s === 'up' ? 'running' : 'down'];
  }
  showIntBrief() {
    this.print(`${pad('Interface', 22)}${pad('Status', 16)}Protocol`);
    for (const pt of this.dev.ports) { const [s, p] = this.pstate(pt); this.print(`${pad(pt.name, 22)}${pad(s, 16)}${p}`); }
    for (const s of this.cfg.svis ?? []) this.print(`${pad(`vlan${s.vlan}`, 22)}${pad(s.adminUp ? 'admin up' : 'admin down', 16)}${sviUp(this.p, this.dev, s.vlan) ? 'running' : 'down'}`);
  }
  showIpIntBrief() {
    this.print(`${pad('Interface', 22)}${pad('IP-Address', 19)}${pad('Status', 16)}Protocol`);
    for (const pt of this.dev.ports) { const [s, p] = this.pstate(pt); this.print(`${pad(pt.name, 22)}${pad(pt.ip ?? 'unassigned', 19)}${pad(s, 16)}${p}`); }
    for (const s of this.cfg.svis ?? []) this.print(`${pad(`vlan${s.vlan}`, 22)}${pad(s.ip ?? 'unassigned', 19)}${pad(s.adminUp ? 'admin up' : 'admin down', 16)}${sviUp(this.p, this.dev, s.vlan) ? 'running' : 'down'}`);
  }
  showVlan() {
    this.print(`${pad('VLAN ID', 9)}${pad('Name', 17)}${pad('Type', 8)}${pad('State', 8)}Member ports`, `${' '.repeat(42)}(u)-Untagged, (t)-Tagged`, '======= ================ ======= ======= ====================================');
    for (const v of this.cfg.vlans!) {
      const members = this.dev.ports.filter((pt) => pt.mode === 'trunk' ? (pt.nativeVlan === v.id || pt.trunkAllowed === 'all' || (pt.trunkAllowed ?? []).includes(v.id)) : (pt.accessVlan ?? 1) === v.id)
        .map((pt) => `${pt.name}(${pt.mode === 'trunk' && pt.nativeVlan !== v.id ? 't' : 'u'})`);
      const lines: string[] = [];
      for (let i = 0; i < members.length; i += 3) lines.push(members.slice(i, i + 3).join(' '));
      this.print(`${pad(v.id, 9)}${pad(v.name, 17)}${pad('STATIC', 8)}${pad('ACTIVE', 8)}${lines[0] ?? ''}`);
      for (const l of lines.slice(1)) this.print(' '.repeat(42) + l);
    }
  }
  showRoute() {
    this.print('Codes: C - connected, S - static, R - RIP, B - BGP', '       O - OSPF, IA - OSPF inter area', '       * - candidate default', '');
    const t = routingTable(this.p, this.dev);
    const def = t.find((r) => r.type === 'S' && r.prefix === 0);
    this.print(def ? `Gateway of last resort is ${def.nextHop} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    for (const r of t) this.print(r.type === 'L' ? `L       ${r.network}/${r.prefix} is directly connected, ${r.ifc!.name}` : r.type === 'S' ? `S${r.prefix === 0 ? '*' : ' '}      ${r.network}/${r.prefix} [1/0] via ${r.nextHop}` : `C       ${r.network}/${r.prefix} is directly connected, ${r.ifc!.name}`);
  }
  showArp() {
    this.print(`${pad('IP Address', 16)}${pad('MAC Address', 16)}${pad('Interface', 12)}${pad('Port', 12)}Type`);
    for (const e of this.ctx.rt.arp[this.dev.id] ?? []) {
      const mac = (this.ctx.rt.mac[this.dev.id] ?? []).find((m) => m.mac === e.mac);
      this.print(`${pad(e.ip, 16)}${pad(macDotted(e.mac), 16)}${pad(e.ifName, 12)}${pad(mac?.port ?? '-', 12)}dynamic`);
    }
  }
  showMac() {
    this.print(`${pad('VLAN', 6)}${pad('port', 17)}${pad('mac', 15)}fwd`);
    for (const e of (this.ctx.rt.mac[this.dev.id] ?? []).filter((m) => portUp(this.p, this.dev, m.port))) this.print(`${pad(e.vlan, 6)}${pad(e.port, 17)}${pad(macDotted(e.mac), 15)}forward   dynamic`);
  }
  render(ports: Port[], c: DeviceConfig): string[] {
    const L = ['!', 'service password-encryption', '!', `hostname ${c.hostname}`, '!', 'no banner motd', '!'];
    const extra = (c.vlans ?? []).filter((v) => v.id !== 1);
    if (extra.length) {
      L.push('vlan database');
      for (const v of extra) L.push(` vlan ${v.id} name ${v.name}`, ` vlan ${v.id} state enable`);
      L.push('!');
    }
    for (const pt of ports) {
      L.push(`interface ${pt.name}`);
      if (pt.description) L.push(` description ${pt.description}`);
      if (this.router) {
        if (pt.ip) L.push(` ip address ${pt.ip}/${maskToPrefix(pt.mask!)}`);
      } else if (pt.mode === 'trunk') {
        L.push(' switchport mode trunk');
        if (pt.trunkAllowed === 'all') L.push(' switchport trunk allowed vlan all');
        else if ((pt.trunkAllowed ?? []).length) L.push(` switchport trunk allowed vlan add ${formatVlanList(pt.trunkAllowed as number[])}`);
        if (pt.nativeVlan === null) L.push(' switchport trunk native vlan none');
        else if (pt.nativeVlan !== 1) L.push(` switchport trunk native vlan ${pt.nativeVlan}`);
      } else {
        L.push(' switchport mode access');
        if ((pt.accessVlan ?? 1) !== 1) L.push(` switchport access vlan ${pt.accessVlan}`);
      }
      if (!pt.adminUp) L.push(' shutdown');
      L.push('!');
    }
    for (const s of c.svis ?? []) {
      L.push(`interface vlan${s.vlan}`);
      if (s.description) L.push(` description ${s.description}`);
      if (s.ip) L.push(` ip address ${s.ip}/${maskToPrefix(s.mask!)}`);
      if (!s.adminUp) L.push(' shutdown');
      L.push('!');
    }
    for (const r of c.routes ?? []) L.push(`ip route ${r.network}/${maskToPrefix(r.mask)} ${r.nextHop}`);
    if (c.routes?.length) L.push('!');
    L.push('line con 0', 'line vty 0 4', '!', 'end');
    return L;
  }
}
void getModel;
