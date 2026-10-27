import type { Categories } from './types';

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

function gtag(...args: unknown[]): void {
  const w = window as GtagWindow;
  if (typeof w.gtag !== 'function') {
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js expects the `arguments` object itself, not an array.
    w.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  w.gtag(...args);
}

const state = (granted: boolean) => (granted ? 'granted' : 'denied');

function toConsentMode(c: Categories): Record<string, string> {
  return {
    analytics_storage: state(c.analytics),
    ad_storage: state(c.marketing),
    ad_user_data: state(c.marketing),
    ad_personalization: state(c.marketing),
    functionality_storage: state(c.preferences),
    personalization_storage: state(c.preferences),
  };
}

/** Google Consent Mode v2: everything denied until the visitor chooses. */
export function consentModeDefault(): void {
  gtag('consent', 'default', {
    ...toConsentMode({ necessary: true, preferences: false, analytics: false, marketing: false }),
    security_storage: 'granted',
    wait_for_update: 500,
  });
  gtag('set', 'ads_data_redaction', true);
}

export function consentModeUpdate(c: Categories): void {
  gtag('consent', 'update', toConsentMode(c));
}
