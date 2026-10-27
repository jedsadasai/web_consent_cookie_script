import type { Categories, ConsentAction, Lang } from './types';

export interface ConsentPayload {
  eventId: string;
  consentId: string;
  siteKey: string;
  subjectId?: string;
  action: ConsentAction;
  categories: Categories;
  policyVersion: string;
  language: Lang;
  pageUrl?: string;
}

/** Page URL without query string or hash — those may carry personal data. */
export function currentPageUrl(): string | undefined {
  const { origin, pathname } = location;
  return origin && origin !== 'null' ? `${origin}${pathname}` : undefined;
}

/** Fire-and-forget: the banner must keep working even if the API is down. */
export function sendConsent(url: string, payload: ConsentPayload): Promise<void> {
  try {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'strict-origin',
    }).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}
