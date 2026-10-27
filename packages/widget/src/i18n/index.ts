import type { CategoryKey, Lang } from '../types';
import { ALL_CATEGORIES } from '../types';
import { en } from './en';
import { th } from './th';

export interface CategoryText {
  title: string;
  description: string;
}

export interface Texts {
  bannerTitle: string;
  bannerBody: string;
  policyLink: string;
  newTab: string;
  acceptAll: string;
  rejectAll: string;
  customize: string;
  prefsTitle: string;
  prefsBody: string;
  save: string;
  close: string;
  alwaysOn: string;
  settingsButton: string;
  /** Short label of the *other* language, shown on the switch button. */
  switchLang: string;
  switchLangLabel: string;
  categories: Record<CategoryKey, CategoryText>;
}

export type TextOverrides = Partial<Omit<Texts, 'categories'>> & {
  categories?: Partial<Record<CategoryKey, Partial<CategoryText>>>;
};

const BASE: Record<Lang, Texts> = { th, en };
const MAX_LEN = 1000;

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_LEN) : fallback;

/** Merge user overrides onto the built-in texts, keeping only non-empty strings. */
export function getTexts(lang: Lang, overrides?: Partial<Record<Lang, TextOverrides>>): Texts {
  const base = BASE[lang];
  const o = overrides?.[lang];
  if (!o || typeof o !== 'object') return base;

  const merged: Texts = { ...base };
  const keys = Object.keys(base).filter((k) => k !== 'categories') as Array<Exclude<keyof Texts, 'categories'>>;
  for (const key of keys) merged[key] = str(o[key], base[key]);
  merged.categories = { ...base.categories };
  for (const cat of ALL_CATEGORIES) {
    const c = o.categories?.[cat];
    merged.categories[cat] = {
      title: str(c?.title, base.categories[cat].title),
      description: str(c?.description, base.categories[cat].description),
    };
  }
  return merged;
}
