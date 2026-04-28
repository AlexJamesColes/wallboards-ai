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

/**
 * Browsers refuse to enter fullscreen without a user gesture (security
 * rule), so true "default to fullscreen" only happens via the PWA path
 * (Add to Home Screen + display:fullscreen manifest). Next best thing:
 * on the very first click / keypress / touch after load, request
 * fullscreen automatically.
 */
export function useAutoFullscreenOnFirstGesture() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.documentElement.requestFullscreen) return;
    if (!shouldAutoFullscreen()) return;

    let fired = false;
    const cleanup = () => {
      window.removeEventListener('click',      fire);
      window.removeEventListener('keydown',    fire);
      window.removeEventListener('touchstart', fire);
    };
    function fire() {
      if (fired) return;
      fired = true;
      cleanup();
      if (document.fullscreenElement) return;
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }

    window.addEventListener('click',      fire);
    window.addEventListener('keydown',    fire);
    window.addEventListener('touchstart', fire, { passive: true });

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
    if (!document.documentElement.requestFullscreen) return;
    if (!shouldAutoFullscreen()) return;

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      if (document.fullscreenElement) return;
      timer = setTimeout(() => {
        if (document.fullscreenElement) return;
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }, idleMs);
    };

    arm();
    const events = ['click', 'keydown', 'touchstart', 'mousemove', 'pointermove'];
    events.forEach(e => window.addEventListener(e, arm, { passive: true }));
    const onFsChange = () => arm();
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, arm));
      document.removeEventListener('fullscreenchange', onFsChange);
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
