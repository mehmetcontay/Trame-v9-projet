// Fonctions partagées entre les interpréteurs de commandes.
import type { Port, Acl, AclEntry } from '../model/types';
export const pad = (s: string | number, n: number) => String(s).padEnd(n);
export function fakeHash(pw: string): string {
  let h1 = 5381, h2 = 52711;
  for (const c of pw) { h1 = (h1 * 33) ^ c.charCodeAt(0); h2 = (h2 * 31) ^ c.charCodeAt(0); }
  const chars = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = '';
  let x = Math.abs(h1) * 7919 + Math.abs(h2);
  for (let i = 0; i < 22; i++) { s += chars[x % 64]; x = Math.floor(x / 64) + (i + 1) * Math.abs(h2 % 997); }
  return `$1$mERr$${s}`;
}
export function addrSpec(ip: string, wc: string): string {
  if (wc === '255.255.255.255') return 'any';
  if (wc === '0.0.0.0') return `host ${ip}`;
  return `${ip} ${wc}`;
}
export function aclEntryText(acl: Acl, e: AclEntry): string {
  return acl.type === 'standard'
    ? `${e.action} ${addrSpec(e.src, e.srcWc)}`
    : `${e.action} ${e.protocol} ${addrSpec(e.src, e.srcWc)} ${addrSpec(e.dst!, e.dstWc!)}`;
}
export function sortPorts(ports: Port[]) { return ports; }
