import type { Theme } from './config';

/**
 * Placeholders the server replaces with `POLICY_URL` and `THEME` from its env
 * when it serves the bundle (apps/server/src/routes/widget.ts). `build.mjs`
 * checks they survive minification as quoted string literals.
 */
const POLICY_URL_SLOT: string = '__CC_DEFAULT_POLICY_URL__';
const THEME_SLOT: string = '__CC_DEFAULT_THEME__';

/** The server-provided policy URL, or undefined while the slot is unfilled. */
export function defaultPolicyUrl(): string | undefined {
  // A regex test, not a comparison with the placeholder, which esbuild would constant-fold.
  return /^https?:\/\//i.test(POLICY_URL_SLOT) ? POLICY_URL_SLOT : undefined;
}

/** The server-provided theme, or undefined while the slot is unfilled. */
export function defaultTheme(): Theme | undefined {
  return /^(?:auto|light|dark)$/.test(THEME_SLOT) ? (THEME_SLOT as Theme) : undefined;
}
