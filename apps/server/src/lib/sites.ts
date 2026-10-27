const SITE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WILDCARD_PREFIX_RE = /^(https?:\/\/)\*\./i;

/** `https://*.example.com` → any subdomain (any depth) of example.com, same scheme and port; not the apex. */
interface WildcardOrigin {
  protocol: string;
  port: string;
  /** Lower-case, leading dot: `.example.com`. */
  suffix: string;
}

interface SiteOrigins {
  exact: ReadonlySet<string>;
  wildcards: readonly WildcardOrigin[];
}

/** Which browser origins may submit consent for which site key. */
export class SiteRegistry {
  private readonly sites: ReadonlyMap<string, SiteOrigins>;

  private constructor(sites: Map<string, SiteOrigins>) {
    this.sites = sites;
  }

  /**
   * Parse `rjh=https://www.rajthanee.com,https://rajthanee.com;demo=http://localhost:8080`.
   * An origin may use a leading wildcard label: `rjh=https://rajthanee.com,https://*.rajthanee.com`.
   */
  static parse(spec: string): SiteRegistry {
    const sites = new Map<string, SiteOrigins>();
    for (const entry of spec.split(';').map((s) => s.trim()).filter(Boolean)) {
      const eq = entry.indexOf('=');
      const key = eq > 0 ? entry.slice(0, eq).trim() : '';
      if (!SITE_KEY_RE.test(key)) throw new Error(`SITES: invalid site key in "${entry}"`);
      const values = entry
        .slice(eq + 1)
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (values.length === 0) throw new Error(`SITES: site "${key}" has no origins`);
      const exact = new Set<string>();
      const wildcards: WildcardOrigin[] = [];
      for (const value of values) {
        if (WILDCARD_PREFIX_RE.test(value)) wildcards.push(parseWildcard(value, entry));
        else exact.add(normalizeOrigin(value, entry));
      }
      sites.set(key, { exact, wildcards });
    }
    if (sites.size === 0) throw new Error('SITES: at least one site is required');
    return new SiteRegistry(sites);
  }

  isKnownOrigin(origin: string): boolean {
    for (const site of this.sites.values()) if (matches(site, origin)) return true;
    return false;
  }

  allows(siteKey: string, origin: string): boolean {
    const site = this.sites.get(siteKey);
    return site ? matches(site, origin) : false;
  }
}

function matches(site: SiteOrigins, origin: string): boolean {
  if (site.exact.has(origin)) return true;
  if (site.wildcards.length === 0) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Only a well-formed, already-serialised origin may match a pattern.
  if (url.origin !== origin) return false;
  return site.wildcards.some(
    (w) =>
      url.protocol === w.protocol &&
      url.port === w.port &&
      url.hostname.length > w.suffix.length &&
      url.hostname.endsWith(w.suffix),
  );
}

function parseWildcard(value: string, entry: string): WildcardOrigin {
  // Validate the rest of the pattern as an ordinary origin.
  const url = new URL(normalizeOrigin(value.replace(WILDCARD_PREFIX_RE, '$1wildcard.'), entry));
  const base = url.hostname.slice('wildcard.'.length);
  if (base.includes('*') || !base.includes('.') || /^[\d.]+$/.test(base) || base.startsWith('[')) {
    throw new Error(`SITES: wildcard needs a registrable domain like https://*.example.com, not "${value}"`);
  }
  return { protocol: url.protocol, port: url.port, suffix: `.${base}` };
}

function normalizeOrigin(value: string, entry: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SITES: invalid origin "${value}" in "${entry}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SITES: origin must be http(s): "${value}"`);
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`SITES: use a bare origin (scheme://host[:port]) not "${value}"`);
  }
  if (url.hostname.includes('*')) {
    throw new Error(`SITES: a wildcard is only allowed as the first label (https://*.example.com), not "${value}"`);
  }
  return url.origin;
}
