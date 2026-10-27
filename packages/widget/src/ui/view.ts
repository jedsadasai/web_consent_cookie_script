import type { Config } from '../config';
import { getTexts, type Texts } from '../i18n';
import type { Categories, Lang, OptionalCategory } from '../types';
import { h, icon } from './dom';
import { trapFocus } from './focus-trap';
import css from './styles.css';

export interface ViewHandlers {
  acceptAll(): void;
  rejectAll(): void;
  save(selection: Categories): void;
}

const LEAVE_TIMEOUT_MS = 450;
let instances = 0;

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const nextFrame = (fn: () => void): void => {
  requestAnimationFrame(() => requestAnimationFrame(fn));
};

const allOff = (): Categories => ({ necessary: true, preferences: false, analytics: false, marketing: false });

/** Constructable stylesheets are not subject to CSP `style-src`; fall back to a nonce'd <style>. */
function adoptStyles(root: ShadowRoot, cssText: string, nonce: string | undefined, into: HTMLElement): void {
  try {
    if ('adoptedStyleSheets' in root && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      root.adoptedStyleSheets = [sheet];
      return;
    }
  } catch {
    // fall through to <style>
  }
  const style = document.createElement('style');
  if (nonce) style.nonce = nonce;
  style.textContent = cssText;
  into.before(style);
}

/**
 * Renders the banner, the preferences dialog and the floating settings button
 * inside a closed Shadow DOM so host-page CSS cannot affect it (and vice versa).
 */
export class ConsentView {
  lang: Lang;
  private readonly host = document.createElement('div');
  private readonly shadow: ShadowRoot;
  private readonly container = document.createElement('div');
  private readonly id = `cc${++instances}`;

  private bannerOpen = false;
  private prefsOpen = false;
  private hasConsent: boolean;
  private draft: Categories;

  private banner: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private releaseTrap: (() => void) | null = null;
  private returnFocus: string | HTMLElement | null = null;
  private savedOverflow = '';

  constructor(
    private readonly cfg: Config,
    private readonly handlers: ViewHandlers,
    current: Categories | null,
  ) {
    this.lang = cfg.language;
    this.hasConsent = current !== null;
    this.draft = current ? { ...current } : allOff();

    this.host.setAttribute('data-cookie-consent-ui', '');
    if (cfg.theme !== 'auto') this.host.setAttribute('data-theme', cfg.theme);
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.container.className = 'cc-root';
    this.shadow.append(this.container);

    const accent = cfg.accentColor ? `:host{--cc-accent:${cfg.accentColor};--cc-link:${cfg.accentColor}}` : '';
    adoptStyles(this.shadow, css + accent, cfg.nonce, this.container);
  }

  /** Inserted first in <body> so keyboard users reach it first. */
  mount(): void {
    document.body.prepend(this.host);
    this.render();
  }

  showBanner(): void {
    this.bannerOpen = true;
    this.render();
    this.enter(this.banner, true);
  }

  openPreferences(): void {
    if (this.prefsOpen) return;
    const active = this.shadow.activeElement;
    this.returnFocus =
      active instanceof HTMLElement && active.dataset.ccFocus
        ? active.dataset.ccFocus
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    this.prefsOpen = true;
    this.lockScroll(true);
    this.render();
    this.enter(this.banner, false);
    this.enter(this.overlay, true);
    this.overlay?.querySelector<HTMLElement>('.cc-modal')?.focus({ preventScroll: true });
  }

  closePreferences(): void {
    if (!this.prefsOpen) return;
    this.prefsOpen = false;
    this.lockScroll(false);
    this.leave(this.overlay, () => {
      this.rerender();
      this.restoreFocus();
    });
  }

  /** Consent was saved: close everything and show the settings button. */
  finish(current: Categories): void {
    this.hasConsent = true;
    this.draft = { ...current };
    this.bannerOpen = false;
    if (this.prefsOpen) this.lockScroll(false);
    this.prefsOpen = false;
    const hadFocus = this.shadow.activeElement !== null;
    this.leave(this.overlay ?? this.banner, () => {
      this.rerender();
      if (hadFocus) this.focusKey('fab');
    });
  }

  /** Consent was withdrawn: start over. */
  reset(): void {
    this.hasConsent = false;
    this.draft = allOff();
    if (this.prefsOpen) this.lockScroll(false);
    this.prefsOpen = false;
    this.showBanner();
  }

  // ---------------------------------------------------------------------------

  private get texts(): Texts {
    return getTexts(this.lang, this.cfg.texts);
  }

  private render(): void {
    this.releaseTrap?.();
    this.releaseTrap = null;

    const t = this.texts;
    this.banner = this.bannerOpen ? this.buildBanner(t) : null;
    this.overlay = this.prefsOpen ? this.buildPreferences(t) : null;
    const showFab = !this.bannerOpen && !this.prefsOpen && this.hasConsent && this.cfg.settingsButton;

    const nodes: Node[] = [];
    if (this.banner) nodes.push(this.banner);
    if (this.overlay) nodes.push(this.overlay);
    if (showFab) nodes.push(this.buildFab(t));
    this.container.lang = this.lang;
    this.container.replaceChildren(...nodes);

    if (this.overlay) {
      const modal = this.overlay.querySelector<HTMLElement>('.cc-modal');
      if (modal) this.releaseTrap = trapFocus(modal, () => this.closePreferences());
      if (this.banner) this.banner.inert = true;
    }
  }

  private enter(el: HTMLElement | null, animate: boolean): void {
    if (!el) return;
    if (animate && !reducedMotion()) nextFrame(() => el.classList.add('cc-in'));
    else el.classList.add('cc-in');
  }

  private leave(el: HTMLElement | null, done: () => void): void {
    if (!el || reducedMotion()) {
      done();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    el.addEventListener('transitionend', (e) => e.target === el && finish());
    el.classList.remove('cc-in');
    setTimeout(finish, LEAVE_TIMEOUT_MS);
  }

  private lockScroll(lock: boolean): void {
    const style = document.documentElement.style;
    if (lock) {
      this.savedOverflow = style.overflow;
      style.overflow = 'hidden';
    } else {
      style.overflow = this.savedOverflow;
    }
  }

  private focusKey(key: string): boolean {
    const el = this.container.querySelector<HTMLElement>(`[data-cc-focus="${key}"]`);
    el?.focus({ preventScroll: true });
    return !!el;
  }

  private restoreFocus(): void {
    const target = this.returnFocus;
    this.returnFocus = null;
    if (typeof target === 'string' && this.focusKey(target)) return;
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  }

  /** Re-render without entry animations (state already visible). */
  private rerender(): void {
    this.render();
    this.enter(this.banner, false);
    this.enter(this.overlay, false);
  }

  private switchLanguage(): void {
    this.lang = this.lang === 'th' ? 'en' : 'th';
    this.rerender();
    this.focusKey(this.prefsOpen ? 'lang-modal' : 'lang');
  }

  // ---------------------------------------------------------------------------

  private button(label: string, variant: 'primary' | 'ghost', onClick: () => void, focusKey?: string): HTMLButtonElement {
    const btn = h('button', { type: 'button', class: `cc-btn cc-btn-${variant}`, 'data-cc-focus': focusKey }, [label]);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private langButton(t: Texts, focusKey: string): HTMLButtonElement {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'cc-lang',
        lang: this.lang === 'th' ? 'en' : 'th',
        'aria-label': t.switchLangLabel,
        'data-cc-focus': focusKey,
      },
      [t.switchLang],
    );
    btn.addEventListener('click', () => this.switchLanguage());
    return btn;
  }

  private policyLink(t: Texts): HTMLAnchorElement | null {
    if (!this.cfg.policyUrl) return null;
    return h('a', { class: 'cc-link', href: this.cfg.policyUrl, target: '_blank', rel: 'noopener noreferrer' }, [
      t.policyLink,
      h('span', { class: 'cc-sr-only' }, [` ${t.newTab}`]),
    ]);
  }

  private buildBanner(t: Texts): HTMLElement {
    const titleId = `${this.id}-title`;
    const descId = `${this.id}-desc`;
    const link = this.policyLink(t);

    return h(
      'section',
      {
        class: 'cc-banner',
        'data-pos': this.cfg.position,
        role: 'region',
        'aria-labelledby': titleId,
        'aria-describedby': descId,
      },
      [
        h('div', { class: 'cc-content' }, [
          h('div', { class: 'cc-head' }, [
            h('span', { class: 'cc-badge', 'aria-hidden': 'true' }, [icon('cookie')]),
            h('h2', { class: 'cc-title', id: titleId }, [t.bannerTitle]),
            this.langButton(t, 'lang'),
          ]),
          h('p', { class: 'cc-text', id: descId }, [t.bannerBody, link ? ' ' : null, link]),
        ]),
        h('div', { class: 'cc-actions' }, [
          this.button(t.customize, 'ghost', () => this.openPreferences(), 'customize'),
          this.button(t.rejectAll, 'primary', () => this.handlers.rejectAll()),
          this.button(t.acceptAll, 'primary', () => this.handlers.acceptAll()),
        ]),
      ],
    );
  }

  private buildCategory(t: Texts, cat: OptionalCategory): HTMLLIElement {
    const switchId = `${this.id}-sw-${cat}`;
    const descId = `${switchId}-desc`;
    const input = h('input', {
      type: 'checkbox',
      role: 'switch',
      class: 'cc-switch',
      id: switchId,
      'aria-describedby': descId,
    });
    input.checked = this.draft[cat];
    input.addEventListener('change', () => {
      this.draft = { ...this.draft, [cat]: input.checked };
    });

    return h('li', { class: 'cc-cat' }, [
      h('div', { class: 'cc-cat-row' }, [
        h('label', { class: 'cc-cat-title', for: switchId }, [t.categories[cat].title]),
        input,
      ]),
      h('p', { class: 'cc-cat-desc', id: descId }, [t.categories[cat].description]),
    ]);
  }

  private buildPreferences(t: Texts): HTMLElement {
    const titleId = `${this.id}-prefs-title`;
    const descId = `${this.id}-prefs-desc`;
    const link = this.policyLink(t);

    const close = h('button', { type: 'button', class: 'cc-icon-btn', 'aria-label': t.close }, [icon('close')]);
    close.addEventListener('click', () => this.closePreferences());

    const necessary = h('li', { class: 'cc-cat' }, [
      h('div', { class: 'cc-cat-row' }, [
        h('span', { class: 'cc-cat-title', 'data-static': true }, [t.categories.necessary.title]),
        h('span', { class: 'cc-pill' }, [t.alwaysOn]),
      ]),
      h('p', { class: 'cc-cat-desc' }, [t.categories.necessary.description]),
    ]);

    const modal = h(
      'div',
      {
        class: 'cc-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descId,
        tabindex: '-1',
      },
      [
        h('div', { class: 'cc-modal-head' }, [
          h('span', { class: 'cc-badge', 'aria-hidden': 'true' }, [icon('shield')]),
          h('h2', { class: 'cc-title', id: titleId }, [t.prefsTitle]),
          this.langButton(t, 'lang-modal'),
          close,
        ]),
        h('div', { class: 'cc-modal-body' }, [
          h('p', { class: 'cc-text', id: descId }, [t.prefsBody, link ? ' ' : null, link]),
          h('ul', { class: 'cc-cats' }, [necessary, ...this.cfg.categories.map((c) => this.buildCategory(t, c))]),
        ]),
        h('div', { class: 'cc-modal-foot' }, [
          this.button(t.rejectAll, 'ghost', () => this.handlers.rejectAll()),
          this.button(t.acceptAll, 'ghost', () => this.handlers.acceptAll()),
          this.button(t.save, 'primary', () => this.handlers.save({ ...this.draft })),
        ]),
      ],
    );

    const overlay = h('div', { class: 'cc-overlay' }, [modal]);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closePreferences();
    });
    return overlay;
  }

  private buildFab(t: Texts): HTMLButtonElement {
    const fab = h(
      'button',
      {
        type: 'button',
        class: 'cc-fab',
        'data-pos': this.cfg.position === 'bottom-right' ? 'bottom-right' : 'bottom-left',
        'aria-label': t.settingsButton,
        title: t.settingsButton,
        'data-cc-focus': 'fab',
      },
      [icon('cookie')],
    );
    fab.addEventListener('click', () => this.openPreferences());
    return fab;
  }
}
