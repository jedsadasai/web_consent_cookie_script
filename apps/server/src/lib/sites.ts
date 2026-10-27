const SITE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Which browser origins may submit consent for which site key. */
export class SiteRegistry {
  private readonly sites: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly anyOrigin: ReadonlySet<string>;

  constructor(sites: Map<string, Set<string>>) {
    this.sites = sites;
    this.anyOrigin = new Set([...sites.values()].flatMap((s) => [...s]));
  }

  /** Parse `rjh=https://www.rajthanee.com,https://rajthanee.com;demo=http://localhost:8080`. */
  static parse(spec: string): SiteRegistry {
    const sites = new Map<string, Set<string>>();
    for (const entry of spec.split(';').map((s) => s.trim()).filter(Boolean)) {
      const eq = entry.indexOf('=');
      const key = eq > 0 ? entry.slice(0, eq).trim() : '';
      if (!SITE_KEY_RE.test(key)) throw new Error(`SITES: invalid site key in "${entry}"`);
      const origins = entry
        .slice(eq + 1)
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => normalizeOrigin(o, entry));
      if (origins.length === 0) throw new Error(`SITES: site "${key}" has no origins`);
      sites.set(key, new Set(origins));
    }
    if (sites.size === 0) throw new Error('SITES: at least one site is required');
    return new SiteRegistry(sites);
  }

  isKnownOrigin(origin: string): boolean {
    return this.anyOrigin.has(origin);
  }

  allows(siteKey: string, origin: string): boolean {
    return this.sites.get(siteKey)?.has(origin) ?? false;
  }
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
  return url.origin;
}
