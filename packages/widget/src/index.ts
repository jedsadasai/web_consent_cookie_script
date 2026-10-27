import { currentPageUrl, sendConsent } from './api';
import { resolveConfig, type UserConfig } from './config';
import { consentModeDefault, consentModeUpdate } from './consent-mode';
import { defaultPolicyUrl } from './defaults';
import { activateGated } from './gating';
import { clearConsent, deleteCookie, readConsent, writeConsent } from './storage';
import type { Categories, CategoryKey, ConsentAction, StoredConsent } from './types';
import { OPTIONAL_CATEGORIES, SUBJECT_ID_RE } from './types';
import { ConsentView } from './ui/view';
import { uuid } from './uuid';

export interface ConsentChange {
  categories: Categories;
  action: ConsentAction;
}

export interface CookieConsentApi {
  readonly version: string;
  /** Current choice, or null if the visitor has not decided yet. */
  get(): Categories | null;
  has(category: CategoryKey): boolean;
  onChange(callback: (change: ConsentChange) => void): () => void;
  /** Open the preferences dialog (e.g. from a "Cookie settings" footer link). */
  open(): void;
  /** Withdraw consent and ask again. */
  reset(): void;
  /** Attach a pseudonymous subject ID (never raw PII) to future consent records. */
  setSubjectId(id: string): boolean;
}

declare global {
  interface Window {
    CookieConsent?: CookieConsentApi;
    CookieConsentConfig?: UserConfig;
  }
  interface WindowEventMap {
    'cookieconsent:change': CustomEvent<ConsentChange>;
  }
}

(function main() {
  if (window.CookieConsent) return; // included twice

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-cookie-consent]');
  const cfg = resolveConfig(script, window.CookieConsentConfig, { policyUrl: defaultPolicyUrl() });

  for (const name of cfg.legacyCookies) deleteCookie(name, cfg.cookieDomain);

  const offered = new Set<CategoryKey>(['necessary', ...cfg.categories]);
  const normalize = (c: Partial<Categories>): Categories => ({
    necessary: true,
    preferences: offered.has('preferences') && c.preferences === true,
    analytics: offered.has('analytics') && c.analytics === true,
    marketing: offered.has('marketing') && c.marketing === true,
  });
  const all = (value: boolean): Categories =>
    normalize({ preferences: value, analytics: value, marketing: value });

  const stored = readConsent();
  const consentId = stored?.id ?? uuid();
  // A new policy version invalidates earlier choices.
  let consent: StoredConsent | null =
    stored && stored.v === cfg.policyVersion ? { ...stored, cats: normalize(stored.cats) } : null;

  const listeners = new Set<(change: ConsentChange) => void>();
  let view: ConsentView | null = null;

  const granted = (k: CategoryKey): boolean => consent !== null && consent.cats[k];

  const actionFor = (c: Categories): ConsentAction => {
    if (cfg.categories.every((k) => c[k])) return 'accept_all';
    if (cfg.categories.every((k) => !c[k])) return 'reject_all';
    return 'custom';
  };

  function record(action: ConsentAction, categories: Categories): Promise<void> {
    if (!cfg.apiUrl) return Promise.resolve();
    const pageUrl = currentPageUrl();
    return sendConsent(cfg.apiUrl, {
      eventId: uuid(),
      consentId,
      siteKey: cfg.siteKey,
      ...(cfg.subjectId ? { subjectId: cfg.subjectId } : {}),
      action,
      categories,
      policyVersion: cfg.policyVersion,
      language: view?.lang ?? cfg.language,
      ...(pageUrl ? { pageUrl } : {}),
    });
  }

  function notify(change: ConsentChange): void {
    listeners.forEach((cb) => {
      try {
        cb(change);
      } catch (err) {
        console.error('[cookie-consent] onChange listener failed', err);
      }
    });
    window.dispatchEvent(new CustomEvent('cookieconsent:change', { detail: change }));
  }

  function commit(action: ConsentAction, selection: Categories): void {
    const previous = consent?.cats ?? null;
    const next = normalize(selection);
    consent = { v: cfg.policyVersion, id: consentId, cats: next, ts: Date.now() };

    const anyOptional = OPTIONAL_CATEGORIES.some((k) => next[k]);
    writeConsent(consent, anyOptional ? cfg.acceptDays : cfg.rejectDays, cfg.cookieDomain);
    if (cfg.googleConsentMode) consentModeUpdate(next);
    activateGated(granted);
    view?.finish(next);

    const sent = record(action, next);
    notify({ categories: { ...next }, action });

    // Scripts that already ran cannot be unloaded; reload so revoked ones stop.
    const revoked = previous !== null && OPTIONAL_CATEGORIES.some((k) => previous[k] && !next[k]);
    if (revoked) void sent.then(() => location.reload());
  }

  function withdraw(): void {
    const previous = consent?.cats ?? null;
    const none = all(false);
    consent = null;
    clearConsent(cfg.cookieDomain);
    if (cfg.googleConsentMode) consentModeUpdate(none);

    const sent = previous ? record('withdraw', none) : Promise.resolve();
    notify({ categories: none, action: 'withdraw' });

    if (previous && OPTIONAL_CATEGORIES.some((k) => previous[k])) void sent.then(() => location.reload());
    else view?.reset();
  }

  if (cfg.googleConsentMode) {
    consentModeDefault();
    if (consent) consentModeUpdate(consent.cats);
  }

  const ready = new Promise<void>((resolve) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    else resolve();
  });

  void ready.then(() => {
    view = new ConsentView(
      cfg,
      {
        acceptAll: () => commit('accept_all', all(true)),
        rejectAll: () => commit('reject_all', all(false)),
        save: (selection) => {
          const next = normalize(selection);
          commit(actionFor(next), next);
        },
      },
      consent ? consent.cats : null,
    );
    view.mount();
    if (consent) activateGated(granted);
    else view.showBanner();
  });

  const api: CookieConsentApi = Object.freeze({
    version: __VERSION__,
    get: () => (consent ? { ...consent.cats } : null),
    has: (category: CategoryKey) => granted(category),
    onChange(callback: (change: ConsentChange) => void) {
      if (typeof callback === 'function') listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    open() {
      void ready.then(() => view?.openPreferences());
    },
    reset() {
      void ready.then(withdraw);
    },
    setSubjectId(id: string) {
      if (typeof id !== 'string' || !SUBJECT_ID_RE.test(id)) return false;
      cfg.subjectId = id;
      return true;
    },
  });

  Object.defineProperty(window, 'CookieConsent', { value: api, writable: false, configurable: false, enumerable: true });
})();
