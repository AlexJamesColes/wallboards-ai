/**
 * Mint a Google Ads OAuth refresh token (one-time setup).
 *
 * The Wallboards backend needs a long-lived refresh token to call the
 * Google Ads API on behalf of a read-only user (alex.coles@bisl.co.uk).
 * Refresh tokens are minted once per user-app pair and live for ~6
 * months (Google rotates them on inactivity but ours will be polled
 * every 5 min via the production app, so it'll never expire).
 *
 * This script runs entirely on your laptop. It opens a local HTTP
 * server, prints a Google consent URL, waits for the redirect after
 * you click Allow, exchanges the auth code for a refresh token, and
 * prints the result. Nothing is uploaded anywhere — copy the printed
 * value into the Heroku env var yourself.
 *
 * RUNNING IT
 * ──────────
 *   GOOGLE_ADS_CLIENT_ID=<your_client_id> \
 *   GOOGLE_ADS_CLIENT_SECRET=<your_client_secret> \
 *   npx tsx scripts/mintGoogleAdsRefreshToken.ts
 *
 * The script prints a URL — open it in any browser, sign in as
 * alex.coles@bisl.co.uk (the read-only user we authorised), click
 * Allow, and the script prints the refresh token in your terminal.
 *
 * WHY DESKTOP-APP OAUTH FLOW?
 * ────────────────────────────
 * The OAuth client we created in Google Cloud Console is type
 * "Desktop app". Desktop apps are allowed to use http://localhost
 * as a redirect URI without registration, which means we can run a
 * one-time server on this script with no public hostname. Cleaner
 * than spinning up a temporary Vercel/Heroku endpoint just for the
 * mint flow.
 *
 * SECURITY
 * ────────
 * - The local server only listens on 127.0.0.1, never the public
 *   interface. Nothing reachable from the network.
 * - The auth code Google sends to localhost is a one-time use, valid
 *   for ~10 min. Even if it leaked it'd be useless once exchanged.
 * - The refresh token printed at the end is sensitive. Don't paste
 *   it in chat — it goes straight from your terminal into Heroku
 *   env vars.
 */

import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';
import { platform } from 'os';

const PORT  = 8765; // arbitrary unused port; nothing else likely listening
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Missing GOOGLE_ADS_CLIENT_ID and/or GOOGLE_ADS_CLIENT_SECRET in env.');
  console.error('\nRun like this:\n');
  console.error('  GOOGLE_ADS_CLIENT_ID=...apps.googleusercontent.com \\');
  console.error('  GOOGLE_ADS_CLIENT_SECRET=GOCSPX-... \\');
  console.error('  npx tsx scripts/mintGoogleAdsRefreshToken.ts\n');
  process.exit(1);
}

const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

// Build the consent URL Google will send the user to. `access_type=offline`
// + `prompt=consent` together guarantee Google issues a refresh token
// even if the same user has previously granted consent for this client.
const consentUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consentUrl.searchParams.set('client_id',     CLIENT_ID);
consentUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
consentUrl.searchParams.set('response_type', 'code');
consentUrl.searchParams.set('scope',         SCOPE);
consentUrl.searchParams.set('access_type',   'offline');
consentUrl.searchParams.set('prompt',        'consent');

console.log('\n🔐 Google Ads refresh-token mint\n');
console.log('1. A browser tab is about to open the Google consent screen.');
console.log('2. Sign in as the read-only user (alex.coles@bisl.co.uk).');
console.log('3. Click Allow when prompted.');
console.log('4. The refresh token will print here once Google redirects back.\n');
console.log('If the browser doesn\'t open automatically, paste this URL:');
console.log('\n   ' + consentUrl.toString() + '\n');

// ─── Local callback server ──────────────────────────────────────────────
//
// Listens for Google's redirect on http://127.0.0.1:PORT/oauth2callback.
// Receives the auth code, exchanges it for a refresh token, prints the
// result, and shuts down. Only handles one request — we're not running
// a real server, just catching the callback.

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (requestUrl.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }

  const code  = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' }).end(
      `<h1>Auth failed</h1><pre>${error}</pre><p>Check your terminal for details.</p>`,
    );
    console.error(`\n❌ OAuth error: ${error}\n`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' }).end(
      '<h1>No code received</h1><p>Check your terminal.</p>',
    );
    console.error('\n❌ No auth code in callback. Cannot proceed.\n');
    server.close();
    process.exit(1);
  }

  // Exchange the auth code for a refresh token.
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }).toString(),
    });

    const json = await tokenRes.json() as any;
    if (!tokenRes.ok || !json.refresh_token) {
      throw new Error(json.error_description || json.error || 'No refresh_token in response');
    }

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      '<h1>✅ Done</h1><p>You can close this tab. Check your terminal for the refresh token.</p>',
    );

    console.log('\n✅ Got the refresh token.\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('GOOGLE_ADS_REFRESH_TOKEN=' + json.refresh_token);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Next steps:');
    console.log('  1. Copy that GOOGLE_ADS_REFRESH_TOKEN= line above.');
    console.log('  2. Set it on Heroku:  heroku config:set ... -a wallboards');
    console.log('  3. Also set the other 5 env vars (see commit message of the');
    console.log('     googleAds.ts integration when it lands):');
    console.log('       GOOGLE_ADS_CLIENT_ID');
    console.log('       GOOGLE_ADS_CLIENT_SECRET');
    console.log('       GOOGLE_ADS_DEVELOPER_TOKEN');
    console.log('       GOOGLE_ADS_LOGIN_CUSTOMER_ID  (= 6782985772)');
    console.log('       GOOGLE_ADS_CUSTOMER_IDS       (= 9003332676,3003732501)');
    console.log('  4. The wallboard\'s VC Spend tile will populate within 5 min.\n');
    console.log('Refresh tokens last ~6 months of inactivity. The wallboard polls');
    console.log('every 5 min, so this token will keep working indefinitely.\n');

    server.close();
    process.exit(0);
  } catch (e: any) {
    res.writeHead(500, { 'Content-Type': 'text/html' }).end(
      `<h1>Token exchange failed</h1><pre>${e?.message || e}</pre>`,
    );
    console.error('\n❌ Token exchange failed: ' + (e?.message || e) + '\n');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`(Listening on http://127.0.0.1:${PORT} for the callback…)\n`);

  // Try to open the browser automatically. If the OS-specific opener
  // command isn't available (rare CI envs, headless boxes), the user
  // can copy the URL printed above manually — both paths land in the
  // same place.
  const opener = platform() === 'darwin'  ? 'open'
              : platform() === 'win32'    ? 'start ""'
              :                              'xdg-open';
  exec(`${opener} "${consentUrl.toString()}"`, err => {
    if (err) {
      console.log('(Couldn\'t auto-open the browser — copy the URL above manually.)\n');
    }
  });
});

// Friendly Ctrl-C handler so a cancelled flow doesn't leave an orphaned
// listening socket on the next attempt.
process.on('SIGINT', () => {
  console.log('\nCancelled. Run again whenever you\'re ready.\n');
  server.close();
  process.exit(130);
});
