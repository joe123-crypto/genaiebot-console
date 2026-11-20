# Google authentication

All console pages, API handlers and server actions require a verified Firebase
session. Any Google account with a verified email can access this **shared bot
console**. There are no viewer/admin roles or per-user bot datasets. The existing
`CONSOLE_WRITES` switch and backend capabilities still control editing.

## Configured Firebase resources

- Project: **Genaie Database**, `database-8982a`.
- Web app: **Genaie Console**, `1:766882916139:web:8733489a96e8e6dbce076e`.
- Google provider enabled; `localhost` and `127.0.0.1` added to authorized domains.
- Service account: `genaie-console-auth@database-8982a.iam.gserviceaccount.com`,
  with the Firebase Authentication Admin role. It does not receive Firestore access.

Authentication users and provider settings are project-wide, including the existing
Filter-backend web app. Existing providers and authorized domains were preserved.
The browser never receives the service-account private key or bot credentials.

## Run locally with real Google sign-in

Use Node.js 22 or later and `npm install`. Copy `.env.example` to `.env.local`
only if local configuration has not already been prepared.

The prepared `.env.local` contains this web app's public Firebase configuration,
`FIREBASE_PROJECT_ID`, `APP_ORIGIN=http://localhost:3000`, and an ADC credential
path outside the repository. The credential file is stored with owner-only
permissions at `~/.config/genaie-console/firebase-auth-service-account.json`.

On another machine, obtain credentials for the Auth service account through your
normal secret-sharing process. Set `GOOGLE_APPLICATION_CREDENTIALS` to its JSON
file path, or set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. Literal `\n`
characters in a PEM environment variable are converted to newlines. Partial
email/private-key configuration is rejected. The server and public project IDs
must match.

Run `npm run dev` and open **http://localhost:3000**. If using another local
origin or port, update `APP_ORIGIN` to that exact origin and restart the server.
Use **Continue with Google**, select an account and open the console. Reload to
verify persistence, then use **Sign out**. Enable popups if the browser blocks
the Google window. An unauthorized-domain error means the hostname must be added
under Firebase Authentication → Settings → Authorized domains.

On a network without a working IPv6 route, Node's connection to Google's token
service may fail. Start the local server with
`NODE_OPTIONS=--dns-result-order=ipv4first npm run dev` in that environment.

The browser SDK uses in-memory persistence. After sign-in, a recent Firebase ID
token is exchanged for a seven-day, HTTP-only session cookie. The browser SDK is
then signed out. Sessions are verified server-side with revocation checks.
Expiration requires a fresh Google sign-in; there is no silent renewal. Sign-out
clears this browser's session, not sessions on other devices. Disabling a Firebase
user or revoking their tokens invalidates their sessions on subsequent checks.

## Production setup (deployment is separate)

1. Configure the four `NEXT_PUBLIC_FIREBASE_*` values from this web app and matching
   `FIREBASE_PROJECT_ID` on the console host.
2. Store `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` as server secrets, or
   configure an appropriate Application Default Credential. Do not use a local
   workstation credential path on the deployed host.
3. Set `APP_ORIGIN` to the exact HTTPS console origin, without a path. Browser
   login and logout POSTs are checked against this origin and a short-lived CSRF
   token. Serve the application through this configured origin.
4. Add the production hostname to Firebase Authentication's authorized domains.
   Preserve existing entries. Preview deployments also need their own hostname
   and origin configured before real sign-in works.
5. Ensure the Google OAuth consent configuration permits the intended audience;
   an OAuth app in testing mode restricts login to its configured test users.
   The Firebase auth domain handles Google's OAuth callback at
   `https://database-8982a.firebaseapp.com/__/auth/handler`.
6. Leave emulator variables unset. Rebuild after changing public Firebase values.
   Keep the existing bot connection and write configuration in place.
7. After deployment, verify Google login, a deep-link return, reload, API access
   and sign-out. This implementation does not deploy or change write switches.

Production cookies require HTTPS. Missing credentials and verification outages
deny access; API requests return an unavailable error rather than exposing data.

## Tests

```bash
npm run typecheck
npm test
npm run build
```

For browser tests, install the Firebase CLI and Playwright's Chromium once:

```bash
npx playwright install chromium
npm run test:auth:e2e
```

The browser suite uses `demo-genaie-console`, a loopback Auth Emulator on port
9099, and a separate development server on port 3100. It overrides real Firebase
configuration and does not contact production authentication or mutate the bot.
It exercises Firebase's simulated Google popup, server cookie exchange, reload,
deep links, expiry, draft isolation and multi-tab sign-out. A real Google smoke
test remains a separate check with the account owner choosing their account.

For interactive emulator development, set both
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099`, and use the same
demo project ID in server and browser configuration. Production rejects emulator
settings because emulator tokens are unsigned.

## HTTP interfaces

- `GET /api/auth/csrf`: noncached `{ token }` and a ten-minute, HTTP-only CSRF cookie.
- `POST /api/auth/session`: JSON `{ idToken }`, exact matching `Origin` and
  `X-CSRF-Token` required. Returns `{ operator: { uid, email, name } }` and sets
  `genaie_console_session` for seven days.
- `GET /api/auth/session`: returns the operator, `401` when signed out, or `503`
  when verification is unavailable.
- `DELETE /api/auth/session`: JSON request with the same origin/CSRF protection;
  clears the cookie even if the old session expired.

Protected APIs return JSON `401`, not login HTML. Pages and server actions redirect
to `/login?returnTo=…`. Only local return paths are accepted. Session expiry retains
existing browser-stored drafts for the same user; signing out or switching identity
clears console draft storage. Rejected server-to-bot credentials return a service
error (`502`) rather than expiring a valid browser session.
Audit fields accepted by existing bot APIs identify the server-verified email and UID.
Actor labels honor the existing 120-character backend limit: long emails are
shortened while retaining the UID, and unusually long imported UIDs use a stable
SHA-256 reference.
