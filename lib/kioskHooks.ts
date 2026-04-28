'use client';

import { useEffect } from 'react';

/**
 * Shared kiosk-mode behaviours for any wallboard rendered on a wall-
 * mounted screen. ShowcaseView (leaderboards) and AgentStatesView
 * (live agent grid) both pull from this module so a TV running either
 * board behaves identically: auto-fullscreen on first remote tap,
 * cursor auto-hide after a few seconds, page reload when a new build
 * lands.
 *
 * All hooks are no-ops on phones / desktop browsers by default — the
 * UA detection in `isTvBrowser()` keeps them from yanking a phone into
 * fullscreen on first tap. Override per-page with `?fs=on` / `?fs=off`.
 */

// ────────────────────────────────────────────────────────────────────
//  TV / set-top-box detection
// ────────────────────────────────────────────────────────────────────

/** True when the browser looks like a TV / set-top-box agent (Tizen,
 *  WebOS, generic SmartTV / HbbTV strings). Auto-fullscreen behaviour
 *  is gated on this so a phone or desktop browser doesn't get yanked
 *  into fullscreen on the first click. Conservative — pattern only
 *  matches user-agents we expect to come from a wall-mounted screen. */
export function isTvBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\b(Tizen|SmartTV|SMART-TV|WebOS|Web0S|HbbTV|VIDAA|NetCast|BRAVIA|GoogleTV|Android\s?TV)\b/i.test(ua);
}

/** Auto-fullscreen decision. ?fs=off disables everywhere (laptop dev),
 *  ?fs=on forces it on any browser (handy for one-off testing on a
 *  phone). Default: TV browsers only. */
export function shouldAutoFullscreen(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = new URLSearchParams(window.location.search).get('fs');
  if (flag === 'off') return false;
  if (flag === 'on')  return true;
  return isTvBrowser();
}

// ────────────────────────────────────────────────────────────────────
//  Auto-fullscreen on first user gesture
// ────────────────────────────────────────────────────────────────────

/** Vendor-aware fullscreen entry. Samsung Tizen builds vary — newer
 *  ones support the spec-standard `requestFullscreen({navigationUI})`,
 *  older ones only expose `webkitRequestFullscreen` (no options), and
 *  some reject the options object entirely. Try in order, falling back
 *  to no-options on rejection. Resolves true on success, false on every
 *  attempt failing — caller can decide whether to keep listening. */
function enterFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const el = document.documentElement as any;
  if (document.fullscreenElement || el.webkitFullscreenElement) return Promise.resolve(true);

  const req: ((opts?: any) => Promise<void> | void) | undefined =
    el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (!req) return Promise.resolve(false);

  const tryCall = (opts?: any): Promise<boolean> => {
    try {
      const result = req.call(el, opts);
      // Older prefixed implementations are sync, no promise.
      if (result && typeof (result as Promise<void>).then === 'function') {
        return (result as Promise<void>).then(() => true).catch(() => false);
      }
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  };

  // Try with the URL-bar-hiding option first (cleaner on Tizen 6+),
  // fall back to no options if that's rejected (older Tizen / WebOS).
  return tryCall({ navigationUI: 'hide' }).then(ok => ok ? true : tryCall());
}

/**
 * Browsers refuse to enter fullscreen without a user gesture (security
 * rule), so true "default to fullscreen" only happens via the PWA path
 * (Add to Home Screen + display:fullscreen manifest). Next best thing:
 * on every gesture until we successfully enter fullscreen, try to do so.
 *
 * Crucially we don't latch `fired = true` until the request *actually*
 * succeeds — earlier versions disarmed after the first click even when
 * Tizen rejected the call, which left the TV stuck with the URL bar
 * visible until a page reload. Now subsequent clicks/keydowns keep
 * retrying through the vendor-prefix fallback chain.
 */
export function useAutoFullscreenOnFirstGesture() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!shouldAutoFullscreen()) return;

    let done = false;
    const events = ['click', 'keydown', 'touchstart', 'pointerdown'] as const;
    const cleanup = () => {
      events.forEach(e => window.removeEventListener(e, fire as any));
    };
    async function fire() {
      if (done) return;
      const ok = await enterFullscreen();
      if (ok) { done = true; cleanup(); }
      // Failure → leave listeners armed so the next remote tap retries.
    }

    events.forEach(e => window.addEventListener(e, fire as any, { passive: true } as any));

    return cleanup;
  }, []);
}

// ────────────────────────────────────────────────────────────────────
//  Auto-fullscreen after idle
// ────────────────────────────────────────────────────────────────────

/**
 * Best-effort auto-fullscreen after a period of no user activity.
 * Spec-compliant browsers refuse this (no transient activation), some
 * Tizen kiosk firmwares allow it. Silent fail when refused.
 */
export function useAutoFullscreenAfterIdle(idleMs: number) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!shouldAutoFullscreen()) return;

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) return;
      timer = setTimeout(() => { void enterFullscreen(); }, idleMs);
    };

    arm();
    const events = ['click', 'keydown', 'touchstart', 'mousemove', 'pointermove'];
    events.forEach(e => window.addEventListener(e, arm, { passive: true }));
    const onFsChange = () => arm();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange' as any, onFsChange);

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, arm));
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange' as any, onFsChange);
    };
  }, [idleMs]);
}

// ────────────────────────────────────────────────────────────────────
//  Auto-hide cursor
// ────────────────────────────────────────────────────────────────────

/**
 * Hides the mouse / Samsung Smart Remote pointer after `idleMs` of no
 * movement. Reappears on the next pointermove, then re-hides after
 * the timer expires again. Uses a CSS class on <html> so the
 * specificity holds against descendant `cursor: pointer` elements.
 */
export function useAutoHideCursor(idleMs: number) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout>;
    const HIDDEN = 'wb-cursor-hidden';

    const arm = () => {
      root.classList.remove(HIDDEN);
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.add(HIDDEN), idleMs);
    };
    arm();
    document.addEventListener('pointermove', arm, { passive: true });
    document.addEventListener('keydown',     arm);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', arm);
      document.removeEventListener('keydown',     arm);
      root.classList.remove(HIDDEN);
    };
  }, [idleMs]);
}

// ────────────────────────────────────────────────────────────────────
//  Auto-reload on new deploy
// ────────────────────────────────────────────────────────────────────

/**
 * Polls /api/version every 2 minutes. When the build id changes,
 * hard-reload — picks up new wallboard code on TVs that have been up
 * for weeks without anyone touching them.
 */
export function useAutoReloadOnDeploy() {
  useEffect(() => {
    let firstId: string | null = null;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const { id } = await res.json();
        if (!id) return;
        if (firstId === null) { firstId = id; return; }
        if (id !== firstId) window.location.reload();
      } catch { /* ignore */ }
    };
    check();
    const iv = setInterval(check, 120_000);
    return () => clearInterval(iv);
  }, []);
}
