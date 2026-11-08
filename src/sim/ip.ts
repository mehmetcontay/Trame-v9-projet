// Utilitaires IPv4.
export function parseIp(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}
export const isIp = (s: string | undefined | null) => parseIp(s) !== null;
export function intToIp(n: number): string {
  n = n >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
export function maskToPrefix(m: string | undefined | null): number | null {
  const n = parseIp(m);
  if (n === null) return null;
  let p = 0, zero = false;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) { if (zero) return null; p++; } else zero = true;
  }
  return p;
}
export function prefixToMask(p: number): string {
  return intToIp(p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
}
export const isMask = (s: string | undefined | null) => maskToPrefix(s) !== null;
export function maskInt(m: string): number { return parseIp(m) ?? 0; }
export function networkInt(ip: string, mask: string): number { return ((parseIp(ip) ?? 0) & maskInt(mask)) >>> 0; }
export function networkOf(ip: string, mask: string): string { return intToIp(networkInt(ip, mask)); }
export function broadcastInt(ip: string, mask: string): number { return (networkInt(ip, mask) | (~maskInt(mask) >>> 0)) >>> 0; }
export function inSubnet(ip: string, net: string, mask: string): boolean {
  const a = parseIp(ip), n = parseIp(net), m = parseIp(mask);
  if (a === null || n === null || m === null) return false;
  return ((a & m) >>> 0) === ((n & m) >>> 0);
}
export function isUsableHost(ip: string, mask: string): boolean {
  const p = maskToPrefix(mask);
  if (p === null || !isIp(ip)) return false;
  if (p >= 31) return true;
  const a = parseIp(ip)!;
  return a !== networkInt(ip, mask) && a !== broadcastInt(ip, mask);
}
export function wildcardMatch(ip: string, base: string, wc: string): boolean {
  const a = parseIp(ip), b = parseIp(base), w = parseIp(wc);
  if (a === null || b === null || w === null) return false;
  const care = ~w >>> 0;
  return ((a & care) >>> 0) === ((b & care) >>> 0);
}
/** Parse "192.168.1.1/24" -> {ip, mask} */
export function parseCidr(s: string): { ip: string; mask: string; prefix: number } | null {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(s.trim());
  if (!m || !isIp(m[1])) return null;
  const p = Number(m[2]);
  if (p > 32) return null;
  return { ip: m[1], mask: prefixToMask(p), prefix: p };
}
