import type { TextOverrides } from './i18n';
import type { Lang, OptionalCategory } from './types';
import { OPTIONAL_CATEGORIES, SITE_KEY_RE, SUBJECT_ID_RE, VERSION_RE } from './types';

export type Theme = 'auto' | 'light' | 'dark';
const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];
export type Position = 'bottom' | 'bottom-left' | 'bottom-right';

/** Options accepted from `data-*` attributes or `window.CookieConsentConfig`. */
export interface UserConfig {
  siteKey?: string;
  apiUrl?: string;
  policyUrl?: string;
  policyVersion?: string;
  language?: Lang | 'auto';
  subjectId?: string;
  /** Optional categories to offer; omitted ones are always denied. */
  categories?: OptionalCategory[];
  acceptDays?: number;
  rejectDays?: number;
  settingsButton?: boolean;
  accentColor?: string;
  theme?: Theme;
  position?: Position;
  googleConsentMode?: boolean;
  cookieDomain?: string;
  /** Cookies set by the previous banner, removed on load. */
  legacyCookies?: string[];
  texts?: Partial<Record<Lang, TextOverrides>>;
}

export interface Config {
  siteKey: string;
  apiUrl: string | null;
  policyUrl: string | null;
  policyVersion: string;
  language: Lang;
  subjectId: string | null;
  categories: OptionalCategory[];
  acceptDays: number;
  rejectDays: number;
  settingsButton: boolean;
  accentColor: string | null;
  theme: Theme;
  position: Position;
  googleConsentMode: boolean;
  cookieDomain: string | null;
  legacyCookies: string[];
  texts: Partial<Record<Lang, TextOverrides>>;
  nonce: string | undefined;
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DOMAIN_RE = /^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const COOKIE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_LEGACY_COOKIES = ['acceptCookies', '_atk', '_ipd'];

/** Resolve a URL and accept it only when it is http(s); blocks `javascript:` etc. */
export function safeHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value, base ?? location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

const matches = (value: unknown, re: RegExp): string | null =>
  typeof value === 'string' && re.test(value) ? value : null;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '') return true;
  if (value === 'false') return false;
  return fallback;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}

function toList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return undefined;
}

export function detectLanguage(preferred: unknown): Lang {
  if (preferred === 'th' || preferred === 'en') return preferred;
  const htmlLang = document.documentElement.lang.toLowerCase();
  if (htmlLang.startsWith('th')) return 'th';
  if (htmlLang.startsWith('en')) return 'en';
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : '').toLowerCase();
  return nav.startsWith('th') || nav === '' ? 'th' : 'en';
}

/** Read options from the `<script>` tag's data attributes. */
export function readScriptAttributes(script: HTMLScriptElement | null): Record<string, unknown> {
  if (!script) return {};
  const d = script.dataset;
  const raw: Record<string, unknown> = {
    siteKey: d.site,
    apiUrl: d.api,
    policyUrl: d.policyUrl,
    policyVersion: d.policyVersion,
    language: d.lang,
    subjectId: d.subjectId,
    categories: d.categories,
    acceptDays: d.acceptDays,
    rejectDays: d.rejectDays,
    settingsButton: d.settingsButton,
    accentColor: d.accent,
    theme: d.theme,
    position: d.position,
    googleConsentMode: d.googleConsentMode,
    cookieDomain: d.cookieDomain,
    legacyCookies: d.legacyCookies,
  };
  for (const key of Object.keys(raw)) if (raw[key] === undefined) delete raw[key];
  return raw;
}

/** Defaults supplied by the serving host, used when the page does not set the option. */
export interface HostDefaults {
  policyUrl?: string;
  theme?: Theme;
}

/**
 * Merge `data-*` attributes with `window.CookieConsentConfig` (the JS object
 * wins) and validate every field; invalid values fall back to safe defaults.
 */
export function resolveConfig(
  script: HTMLScriptElement | null,
  globalConfig?: UserConfig,
  defaults: HostDefaults = {},
): Config {
  const raw: Record<string, unknown> = {
    ...readScriptAttributes(script),
    ...(globalConfig && typeof globalConfig === 'object' ? globalConfig : {}),
  };

  const scriptSrc = script?.src || undefined;
  const apiDefault = scriptSrc ? new URL('/api/v1/consent', scriptSrc).href : null;

  const categories = toList(raw.categories)?.filter((c): c is OptionalCategory =>
    (OPTIONAL_CATEGORIES as readonly string[]).includes(c),
  );

  const legacy = toList(raw.legacyCookies) ?? DEFAULT_LEGACY_COOKIES;

  return {
    siteKey: matches(raw.siteKey, SITE_KEY_RE) ?? 'default',
    apiUrl: raw.apiUrl !== undefined ? safeHttpUrl(raw.apiUrl, scriptSrc) : apiDefault,
    policyUrl: safeHttpUrl(raw.policyUrl ?? defaults.policyUrl),
    policyVersion: matches(raw.policyVersion, VERSION_RE) ?? '1',
    language: detectLanguage(raw.language),
    subjectId: matches(raw.subjectId, SUBJECT_ID_RE),
    categories: categories ?? [...OPTIONAL_CATEGORIES],
    acceptDays: toInt(raw.acceptDays, 365, 1, 395),
    rejectDays: toInt(raw.rejectDays, 180, 1, 395),
    settingsButton: toBool(raw.settingsButton, true),
    accentColor: matches(raw.accentColor, HEX_COLOR_RE),
    theme: oneOf<Theme>(raw.theme, THEMES, oneOf<Theme>(defaults.theme, THEMES, 'auto')),
    position: oneOf<Position>(raw.position, ['bottom', 'bottom-left', 'bottom-right'], 'bottom'),
    googleConsentMode: toBool(raw.googleConsentMode, false),
    cookieDomain: matches(raw.cookieDomain, DOMAIN_RE),
    legacyCookies: legacy.filter((n) => COOKIE_NAME_RE.test(n)),
    texts: raw.texts && typeof raw.texts === 'object' ? (raw.texts as Config['texts']) : {},
    nonce: script?.nonce || undefined,
  };
}
