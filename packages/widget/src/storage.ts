import type { Categories, StoredConsent } from './types';
import { ALL_CATEGORIES, UUID_RE, VERSION_RE } from './types';

export const COOKIE_NAME = 'cc_consent';
const DAY_SECONDS = 86_400;

const toBase64Url = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setCookie(name: string, value: string, days: number, domain?: string | null): void {
  const parts = [`${name}=${value}`, `Max-Age=${Math.round(days * DAY_SECONDS)}`, 'Path=/', 'SameSite=Lax'];
  if (domain) parts.push(`Domain=${domain}`);
  if (location.protocol === 'https:') parts.push('Secure');
  document.cookie = parts.join('; ');
}

export function deleteCookie(name: string, domain?: string | null): void {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  if (domain) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}; SameSite=Lax`;
}

function isCategories(value: unknown): value is Categories {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return ALL_CATEGORIES.every((k) => typeof rec[k] === 'boolean');
}

function isStoredConsent(value: unknown): value is StoredConsent {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.v === 'string' &&
    VERSION_RE.test(c.v) &&
    typeof c.id === 'string' &&
    UUID_RE.test(c.id) &&
    typeof c.ts === 'number' &&
    Number.isFinite(c.ts) &&
    isCategories(c.cats)
  );
}

export function encodeConsent(consent: StoredConsent): string {
  return toBase64Url(JSON.stringify(consent));
}

/** Parse and validate the stored consent; anything malformed is treated as "no consent". */
export function decodeConsent(raw: string): StoredConsent | null {
  try {
    const data: unknown = JSON.parse(fromBase64Url(raw));
    if (!isStoredConsent(data)) return null;
    const cats = {} as Categories;
    for (const k of ALL_CATEGORIES) cats[k] = data.cats[k];
    cats.necessary = true;
    return { v: data.v, id: data.id, cats, ts: data.ts };
  } catch {
    return null;
  }
}

export function readConsent(): StoredConsent | null {
  const raw = readCookie(COOKIE_NAME);
  return raw ? decodeConsent(raw) : null;
}

export function writeConsent(consent: StoredConsent, days: number, domain?: string | null): void {
  setCookie(COOKIE_NAME, encodeConsent(consent), days, domain);
}

export function clearConsent(domain?: string | null): void {
  deleteCookie(COOKIE_NAME, domain);
}
