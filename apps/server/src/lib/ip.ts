import { createHmac } from 'node:crypto';
import { isIP, isIPv4, isIPv6 } from 'node:net';

/** Strip IPv6 zone IDs and unwrap IPv4-mapped addresses (::ffff:1.2.3.4). */
export function normalizeIp(ip: string): string {
  const bare = ip.split('%')[0] ?? ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  return mapped?.[1] ?? bare;
}

/** The full client address in canonical form, or null if it is not a valid IP. */
export function fullIp(ip: string): string | null {
  const addr = normalizeIp(ip);
  return isIP(addr) ? addr : null;
}

function expandIPv6(ip: string): number[] | null {
  let addr = ip;
  // Embedded IPv4 tail, e.g. 64:ff9b::192.0.2.1
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = groups.map((g) => Number.parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

/**
 * Data minimisation: keep only the network part of the address
 * (IPv4 /24, IPv6 /48), which is enough for coarse audit/abuse analysis.
 */
export function truncateIp(ip: string): string | null {
  const addr = normalizeIp(ip);
  if (isIPv4(addr)) {
    const [a, b, c] = addr.split('.');
    return `${a}.${b}.${c}.0`;
  }
  if (isIPv6(addr)) {
    const g = expandIPv6(addr);
    return g ? `${g.slice(0, 3).map((n) => n.toString(16)).join(':')}::` : null;
  }
  return null;
}

/** Keyed hash so the full IP can be correlated (e.g. abuse) but not recovered. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeIp(ip)).digest('hex');
}
