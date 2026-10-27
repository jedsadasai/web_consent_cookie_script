/**
 * Placeholder the server replaces with `POLICY_URL` from its env when it serves
 * the bundle (apps/server/src/routes/widget.ts). `build.mjs` checks it survives
 * minification as a quoted string literal.
 */
const POLICY_URL_SLOT: string = '__CC_DEFAULT_POLICY_URL__';

/** The server-provided policy URL, or undefined while the slot is unfilled. */
export function defaultPolicyUrl(): string | undefined {
  // A regex test, not a comparison with the placeholder, which esbuild would constant-fold.
  return /^https?:\/\//i.test(POLICY_URL_SLOT) ? POLICY_URL_SLOT : undefined;
}
