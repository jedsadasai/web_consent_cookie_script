import { describe, expect, it } from 'vitest';
import { resolveConfig, safeHttpUrl } from '../src/config';
import { defaultPolicyUrl } from '../src/defaults';
import { getTexts } from '../src/i18n';

function scriptWith(data: Record<string, string>, src = 'https://consent.example.com/consent.js'): HTMLScriptElement {
  const s = document.createElement('script');
  s.src = src;
  for (const [k, v] of Object.entries(data)) s.setAttribute(`data-${k}`, v);
  return s;
}

describe('resolveConfig', () => {
  it('reads data attributes and derives the API URL from the script origin', () => {
    const cfg = resolveConfig(
      scriptWith({
        site: 'rjh',
        'policy-url': 'https://www.example.com/policy',
        'policy-version': '2026-10',
        lang: 'en',
        categories: 'analytics,marketing',
        accent: '#123abc',
        position: 'bottom-right',
      }),
    );
    expect(cfg.siteKey).toBe('rjh');
    expect(cfg.apiUrl).toBe('https://consent.example.com/api/v1/consent');
    expect(cfg.policyUrl).toBe('https://www.example.com/policy');
    expect(cfg.policyVersion).toBe('2026-10');
    expect(cfg.language).toBe('en');
    expect(cfg.categories).toEqual(['analytics', 'marketing']);
    expect(cfg.accentColor).toBe('#123abc');
    expect(cfg.position).toBe('bottom-right');
  });

  it('drops unsafe or malformed values', () => {
    const cfg = resolveConfig(
      scriptWith({
        site: 'bad key!',
        'policy-url': 'javascript:alert(1)',
        'policy-version': '1;DROP',
        accent: 'red;background:url(x)',
        'subject-id': '<img>',
        'accept-days': '9999',
        'cookie-domain': 'evil.com;x',
      }),
    );
    expect(cfg.siteKey).toBe('default');
    expect(cfg.policyUrl).toBeNull();
    expect(cfg.policyVersion).toBe('1');
    expect(cfg.accentColor).toBeNull();
    expect(cfg.subjectId).toBeNull();
    expect(cfg.acceptDays).toBe(365);
    expect(cfg.cookieDomain).toBeNull();
  });

  it('falls back to the host policy URL unless the page sets one', () => {
    const host = { policyUrl: 'https://www.rajthanee.com/policy/privacy-policy-cookie' };
    expect(resolveConfig(scriptWith({}), undefined, host).policyUrl).toBe(host.policyUrl);
    expect(resolveConfig(scriptWith({ 'policy-url': 'https://a.example/p' }), undefined, host).policyUrl).toBe(
      'https://a.example/p',
    );
    expect(resolveConfig(scriptWith({}), undefined, { policyUrl: 'javascript:alert(1)' }).policyUrl).toBeNull();
    expect(resolveConfig(scriptWith({})).policyUrl).toBeNull();
  });

  it('ignores the unfilled host policy-URL slot', () => {
    expect(defaultPolicyUrl()).toBeUndefined();
  });

  it('lets window config override attributes', () => {
    const cfg = resolveConfig(scriptWith({ site: 'a' }), { siteKey: 'b', settingsButton: false });
    expect(cfg.siteKey).toBe('b');
    expect(cfg.settingsButton).toBe(false);
  });
});

describe('safeHttpUrl', () => {
  it('allows only http(s)', () => {
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('  ')).toBeNull();
  });
});

describe('getTexts', () => {
  it('merges string overrides and ignores non-strings', () => {
    const t = getTexts('en', {
      en: { acceptAll: 'Allow all', rejectAll: 42 as unknown as string, categories: { analytics: { title: 'Stats' } } },
    });
    expect(t.acceptAll).toBe('Allow all');
    expect(t.rejectAll).toBe('Reject all');
    expect(t.categories.analytics.title).toBe('Stats');
    expect(t.categories.analytics.description).toContain('understand');
  });
});
