import type { MetadataRoute } from 'next';

/**
 * Web app manifest — when a Samsung Tizen browser (or any modern
 * mobile browser) "Add to Home Screen"s a wallboard URL, the
 * resulting launcher opens the page WITHOUT browser chrome. That's
 * the cleanest way to get rid of the URL bar on the TV walls without
 * touching the browser settings on every device.
 *
 * `display: fullscreen` hides both browser chrome AND the system
 * status bar where supported (Tizen, modern Chrome). On platforms
 * that don't honour fullscreen (older mobile browsers), it
 * gracefully falls back to "standalone" — still no URL bar.
 *
 * Next.js auto-discovers app/manifest.ts and serves it at
 * /manifest.webmanifest with the right Content-Type.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'InsureTec Wallboards',
    short_name:       'Wallboards',
    description:      'Live sales wallboards for InsureTec offices.',
    start_url:        '/',
    scope:            '/',
    display:          'fullscreen',
    display_override: ['fullscreen', 'standalone', 'minimal-ui'],
    orientation:      'landscape',
    background_color: '#050813',
    theme_color:      '#050813',
    icons: [
      // SVG icon — the same shield-check mark used in the BrowseHeader.
      // Browsers fall back to favicon.ico if needed.
      {
        src:     '/icon.svg',
        sizes:   'any',
        type:    'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
