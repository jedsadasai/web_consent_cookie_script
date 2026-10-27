import { beforeEach, describe, expect, it } from 'vitest';
import { activateGated, parseRequired } from '../src/gating';
import type { CategoryKey } from '../src/types';

const grant = (...cats: CategoryKey[]) => (c: CategoryKey) => c === 'necessary' || cats.includes(c);

function placeholder(consent: string, attrs: Record<string, string> = {}): HTMLScriptElement {
  const s = document.createElement('script');
  s.type = 'text/plain';
  s.dataset.consent = consent;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  s.text = 'window.__gated = (window.__gated || 0) + 1;';
  document.body.append(s);
  return s;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('parseRequired', () => {
  it('accepts known categories separated by spaces or commas', () => {
    expect(parseRequired('analytics marketing')).toEqual(['analytics', 'marketing']);
    expect(parseRequired('analytics,preferences')).toEqual(['analytics', 'preferences']);
  });

  it('rejects empty or unknown categories', () => {
    expect(parseRequired('')).toBeNull();
    expect(parseRequired('analytics tracking')).toBeNull();
  });
});

describe('activateGated', () => {
  it('leaves scripts inert until their category is granted', () => {
    placeholder('analytics');
    expect(activateGated(grant())).toBe(0);
    expect(document.querySelector('script')?.type).toBe('text/plain');
  });

  it('activates granted scripts and keeps other attributes', () => {
    placeholder('analytics', { id: 'ga', 'data-extra': '1' });
    expect(activateGated(grant('analytics'))).toBe(1);
    const s = document.querySelector('script')!;
    expect(s.hasAttribute('type')).toBe(false);
    expect(s.id).toBe('ga');
    expect(s.dataset.extra).toBe('1');
    expect(s.dataset.consentActivated).toBe('analytics');
  });

  it('requires every listed category', () => {
    placeholder('analytics marketing');
    expect(activateGated(grant('analytics'))).toBe(0);
    expect(activateGated(grant('analytics', 'marketing'))).toBe(1);
  });

  it('only activates iframes with an http(s) data-src', () => {
    const ok = document.createElement('iframe');
    ok.dataset.consent = 'marketing';
    ok.dataset.src = 'https://example.com/embed';
    const bad = document.createElement('iframe');
    bad.dataset.consent = 'marketing';
    bad.dataset.src = 'javascript:alert(1)';
    document.body.append(ok, bad);

    expect(activateGated(grant('marketing'))).toBe(1);
    expect(ok.getAttribute('src')).toBe('https://example.com/embed');
    expect(bad.hasAttribute('src')).toBe(false);
  });
});
