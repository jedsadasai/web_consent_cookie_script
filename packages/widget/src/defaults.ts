import type { LanguageSetting, Theme } from './config';

/**
 * Placeholders the server replaces with `POLICY_URL`, `THEME` and
 * `DEFAULT_LANGUAGE` from its env when it serves the bundle
 * (apps/server/src/routes/widget.ts). `build.mjs` checks they survive
 * minification as quoted string literals.
 */
const POLICY_URL_SLOT: string = '__CC_DEFAULT_POLICY_URL__';
const THEME_SLOT: string = '__CC_DEFAULT_THEME__';
const LANGUAGE_SLOT: string = '__CC_DEFAULT_LANGUAGE__';

/** The server-provided policy URL, or undefined while the slot is unfilled. */
export function defaultPolicyUrl(): string | undefined {
  // A regex test, not a comparison with the placeholder, which esbuild would constant-fold.
  return /^https?:\/\//i.test(POLICY_URL_SLOT) ? POLICY_URL_SLOT : undefined;
}

/** The server-provided theme, or undefined while the slot is unfilled. */
export function defaultTheme(): Theme | undefined {
  return /^(?:auto|light|dark)$/.test(THEME_SLOT) ? (THEME_SLOT as Theme) : undefined;
}

/** The server-provided language, or undefined while the slot is unfilled. */
export function defaultLanguage(): LanguageSetting | undefined {
  return /^(?:auto|th|en)$/.test(LANGUAGE_SLOT) ? (LANGUAGE_SLOT as LanguageSetting) : undefined;
}
