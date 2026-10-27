export type CategoryKey = 'necessary' | 'preferences' | 'analytics' | 'marketing';
export type OptionalCategory = Exclude<CategoryKey, 'necessary'>;
export type Categories = Record<CategoryKey, boolean>;

export const OPTIONAL_CATEGORIES: readonly OptionalCategory[] = ['preferences', 'analytics', 'marketing'];
export const ALL_CATEGORIES: readonly CategoryKey[] = ['necessary', ...OPTIONAL_CATEGORIES];

export type Lang = 'th' | 'en';
export const LANGS: readonly Lang[] = ['th', 'en'];

export type ConsentAction = 'accept_all' | 'reject_all' | 'custom' | 'withdraw';

/** Shape persisted in the `cc_consent` cookie. */
export interface StoredConsent {
  /** Policy version the choice was made against. */
  v: string;
  /** Pseudonymous consent ID, stable across changes on this browser. */
  id: string;
  cats: Categories;
  /** Epoch ms of the choice. */
  ts: number;
}

export const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
export const SITE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SUBJECT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCategory(value: string): value is CategoryKey {
  return (ALL_CATEGORIES as readonly string[]).includes(value);
}
