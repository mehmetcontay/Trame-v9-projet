// État dynamique non sauvegardé : caches ARP et tables MAC apprises pendant la simulation.
export interface ArpEntry { ip: string; mac: string; ifName: string }
export interface MacEntry { mac: string; port: string; vlan: number }
export interface Runtime { arp: Record<string, ArpEntry[]>; mac: Record<string, MacEntry[]> }
export function createRuntime(): Runtime { return { arp: {}, mac: {} }; }
export function learnArp(rt: Runtime | undefined, dev: string, e: ArpEntry) {
  if (!rt) return;
  const list = (rt.arp[dev] ??= []);
  const i = list.findIndex((x) => x.ip === e.ip);
  if (i >= 0) list[i] = e; else list.push(e);
}
export function learnMac(rt: Runtime | undefined, dev: string, e: MacEntry) {
  if (!rt) return;
  const list = (rt.mac[dev] ??= []);
  const i = list.findIndex((x) => x.mac === e.mac && x.vlan === e.vlan);
  if (i >= 0) list[i] = e; else list.push(e);
}
