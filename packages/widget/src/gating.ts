import { safeHttpUrl } from './config';
import type { CategoryKey } from './types';
import { isCategory } from './types';

const SCRIPT_SELECTOR = 'script[type="text/plain"][data-consent]';
const FRAME_SELECTOR = 'iframe[data-consent][data-src]';

/** `data-consent="analytics marketing"` → every listed category must be granted. */
export function parseRequired(value: string | undefined): CategoryKey[] | null {
  const list = (value ?? '').split(/[\s,]+/).filter(Boolean);
  if (list.length === 0 || !list.every(isCategory)) return null;
  return list as CategoryKey[];
}

/**
 * Turn consent-gated placeholders into live elements:
 *   <script type="text/plain" data-consent="analytics" src="…">
 *   <iframe data-consent="marketing" data-src="…">
 * Returns the number of activated elements.
 */
export function activateGated(granted: (category: CategoryKey) => boolean, root: ParentNode = document): number {
  let count = 0;

  root.querySelectorAll<HTMLScriptElement>(SCRIPT_SELECTOR).forEach((placeholder) => {
    const required = parseRequired(placeholder.dataset.consent);
    if (!required || !required.every(granted)) return;

    const script = document.createElement('script');
    for (const attr of Array.from(placeholder.attributes)) {
      if (attr.name === 'type' || attr.name === 'data-consent' || attr.name === 'nonce') continue;
      script.setAttribute(attr.name === 'data-type' ? 'type' : attr.name, attr.value);
    }
    // The nonce attribute is hidden after parsing; the property still holds it.
    if (placeholder.nonce) script.nonce = placeholder.nonce;
    // Dynamically inserted scripts are async by default; keep document order.
    if (!placeholder.hasAttribute('async')) script.async = false;
    if (!placeholder.hasAttribute('src')) script.text = placeholder.text;
    script.setAttribute('data-consent-activated', required.join(' '));
    placeholder.replaceWith(script);
    count++;
  });

  root.querySelectorAll<HTMLIFrameElement>(FRAME_SELECTOR).forEach((frame) => {
    const required = parseRequired(frame.dataset.consent);
    if (!required || !required.every(granted)) return;
    const src = safeHttpUrl(frame.dataset.src);
    if (!src) return;
    frame.removeAttribute('data-src');
    frame.setAttribute('data-consent-activated', required.join(' '));
    frame.src = src;
    count++;
  });

  return count;
}
