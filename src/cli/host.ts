// Invite de commandes des PC et serveurs (style Windows / Packet Tracer).
import { BaseShell, ShellCtx, tokenize } from './framework';
import { ping, traceroute } from '../sim/engine';
import { dhcpRenew, dhcpRelease } from '../sim/dhcp';
import { isIp } from '../sim/ip';
import { macDashed, macDotted } from '../devices/factory';
import { portUp } from '../sim/topology';

const CMDS = ['arp', 'cls', 'help', 'ipconfig', 'ping', 'tracert'];

export class HostShell extends BaseShell {
  questionHelp = false;
  pingMode() { return 'windows' as const; }
  pingProbe(target: string) { return ping(this.ctx.get(), this.ctx.deviceId, target, this.ctx.rt); }
  constructor(ctx: ShellCtx) { super(ctx); }
  prompt() { return 'C:\\>'; }
  banner() { return ['Invite de commandes (simulation Trame)', 'Tapez « help » pour la liste des commandes.', '']; }
  helpLines() { return this.helpText(); }
  helpText() {
    return ['Commandes disponibles :', '  arp -a | -d          Affiche ou vide le cache ARP', '  cls                  Efface l’écran',
      '  ipconfig [/all]      Affiche la configuration IP', '  ipconfig /renew      Demande une adresse au serveur DHCP', '  ipconfig /release    Libère l’adresse DHCP',
      '  ping [-n N] <IP>     Teste la connectivité', '  tracert <IP>         Affiche les routeurs traversés', ''];
  }
  completeLine(line: string) {
    const t = line.trimStart();
    if (t.includes(' ')) return line;
    const c = CMDS.filter((x) => x.startsWith(t.toLowerCase()));
    return c.length === 1 ? c[0] + ' ' : line;
  }
  handle(line: string) {
    const toks = tokenize(line).map((x) => x.t);
    if (!toks.length) return;
    const cmd = toks[0].toLowerCase();
    const h = this.dev.config.host!;
    switch (cmd) {
      case 'help': case '?': this.print(...this.helpText()); return;
      case 'ipconfig': {
        const opt = (toks[1] ?? '').toLowerCase();
        if (opt === '/renew') {
          if (h.mode !== 'dhcp') { this.hint('La carte est en adressage statique : passez en mode DHCP dans l’onglet Configuration IP (ou « ipconfig /renew » le fera pour vous).'); }
          const r = dhcpRenew(this.p, this.dev.id);
          if (r.ok) this.ipconfig(false); else { this.print(r.message.startsWith('Échec DHCP : la carte') ? 'DHCP request failed.' : 'DHCP request failed. APIPA is being used.'); this.hint(r.message); r.notes?.forEach((n) => this.hint(n)); }
          return;
        }
        if (opt === '/release') {
          if (h.mode !== 'dhcp') { this.print('Impossible de libérer l’adresse : cette carte utilise une configuration statique.'); return; }
          dhcpRelease(this.p, this.dev.id); this.ipconfig(false); return;
        }
        if (opt && opt !== '/all') { this.print('Invalid Command.'); return; }
        this.ipconfig(opt === '/all');
        return;
      }
      case 'ping': {
        let n = 4; let target = '';
        for (let i = 1; i < toks.length; i++) {
          if (toks[i] === '-n' && toks[i + 1]) { n = Math.max(1, Math.min(20, +toks[i + 1] || 4)); i++; }
          else target = toks[i];
        }
        if (!isIp(target)) { this.print(target ? `Ping request could not find host ${target}. Please check the name and try again.` : 'Usage : ping [-n count] <adresse IP>'); return; }
        this.print('', `Pinging ${target} with 32 bytes of data:`, '');
        const r = ping(this.p, this.dev.id, target, this.ctx.rt);
        for (let i = 0; i < n; i++) {
          if (r.success) this.print(`Reply from ${target}: bytes=32 time<1ms TTL=${r.ttl}`);
          else if (r.outcome === 'unreachable' && r.replyFrom) this.print(`Reply from ${r.replyFrom}: Destination host unreachable.`);
          else this.print('Request timed out.');
        }
        const recv = r.success ? n : r.outcome === 'unreachable' && r.replyFrom ? n : 0;
        this.print('', `Ping statistics for ${target}:`, `    Packets: Sent = ${n}, Received = ${recv}, Lost = ${n - recv} (${Math.round(((n - recv) / n) * 100)}% loss),`);
        if (r.success) this.print('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms');
        this.print('');
        if (!r.success && r.reason) this.hint(r.reason);
        return;
      }
      case 'tracert': {
        const target = toks[1];
        if (!isIp(target)) { this.print('Usage : tracert <adresse IP>'); return; }
        this.print('', `Tracing route to ${target} over a maximum of 30 hops: `, '');
        const t = traceroute(this.p, this.dev.id, target, this.ctx.rt);
        t.hops.forEach((hp, i) => this.print(`  ${String(i + 1).padStart(2)}   ${hp.ip ? `0 ms      0 ms      0 ms      ${hp.ip}` : '*         *         *         Request timed out.'}`));
        this.print('', t.hops.at(-1)?.final && !t.reason ? 'Trace complete.' : 'Trace interrompu.');
        if (t.reason) this.hint(t.reason);
        return;
      }
      case 'arp': {
        const o = (toks[1] ?? '').toLowerCase();
        if (o === '-d') { delete this.ctx.rt.arp[this.dev.id]; return; }
        if (o !== '-a') { this.print('Usage : arp -a | arp -d'); return; }
        const list = this.ctx.rt.arp[this.dev.id] ?? [];
        if (!list.length) { this.print('No ARP Entries Found'); return; }
        this.print(`  Internet Address      Physical Address      Type`);
        list.forEach((e) => this.print(`  ${e.ip.padEnd(22)}${macDotted(e.mac).padEnd(22)}dynamic`));
        return;
      }
      default:
        this.print('Invalid Command.');
    }
  }
  ipconfig(all: boolean) {
    const h = this.dev.config.host!;
    const port = this.dev.ports[0];
    const connected = portUp(this.p, this.dev, port.name);
    this.print('', `${port.name} Connection:(default port)`, '');
    if (!connected && !h.ip) this.print('   Media State. . . . . . . . . . . : Media disconnected');
    if (all) {
      this.print(`   Physical Address. . . . . . . . . : ${macDashed(port.mac)}`, `   DHCP Enabled. . . . . . . . . . . : ${h.mode === 'dhcp' ? 'Yes' : 'No'}`);
    }
    this.print(`   Connection-specific DNS Suffix..: `, `   IPv4 Address. . . . . . . . . . . : ${h.ip || '0.0.0.0'}`, `   Subnet Mask. . . . . . . . . . . : ${h.mask || '0.0.0.0'}`, `   Default Gateway. . . . . . . . . : ${h.gateway || '0.0.0.0'}`);
    if (all) { this.print(`   DHCP Server. . . . . . . . . . . : ${h.dhcpServer ?? '0.0.0.0'}`, `   DNS Servers. . . . . . . . . . . : ${h.dns || '0.0.0.0'}`); }
    this.print('');
    if (!connected) this.hint('La carte réseau n’est pas connectée (pas de câble ou port d’en face désactivé).');
  }
}
