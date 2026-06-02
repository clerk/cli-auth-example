# clerk-cli-auth

Reference implementation of the OAuth 2.0 Authorization Code + PKCE localhost-callback flow for adding [Clerk](https://clerk.com) authentication to command-line tools.

Runtime-agnostic TypeScript (Node.js 18+, Bun), ~300 lines of real code, tested end-to-end against a real Clerk dev instance.

**Status:** reference implementation. Fork it, copy it, or vendor it into your CLI. This repo is not a published or officially supported `@clerk/cli-auth` package.

## Why this exists

Adding a "sign in with Clerk" flow to a CLI follows a well-known pattern (PKCE + localhost callback + keychain storage), but the details are non-obvious if you've never built one. This repo documents that pattern as a compact TypeScript reference implementation. See the companion write-up at **clerk.com/blog/adding-clerk-auth-to-your-cli**.

## Setup

You need two things: an **OAuth Application** registered with a Clerk instance, and the `client_id` + issuer URL from it.

### 1. Create an OAuth Application

Pick whichever path fits your workflow.

**Clerk Dashboard (recommended for most devs)** — in your dev instance, go to **Configure → OAuth Applications → Create**. Set:

- Name: your CLI's name
- Redirect URI: `http://127.0.0.1/callback` (the CLI listens on a dynamic loopback port and sends the actual `http://127.0.0.1:{port}/callback` redirect URI during authorization)
- Public client (PKCE): enabled
- Scopes: `profile email offline_access`

**curl against BAPI** — if you prefer scripting. Replace `$SK` with your instance's secret key:

```bash
curl -X POST https://api.clerk.com/v1/oauth_applications \
  -H "Authorization: Bearer $SK" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-cli",
    "redirect_uris": ["http://127.0.0.1/callback"],
    "public": true,
    "pkce_required": true,
    "scopes": "profile email offline_access"
  }'
```

**Clerk CLI (if you have it installed)** — `clerk api /oauth_applications --instance <ins_...> -X POST -d '<payload>' --yes` does the same thing with keychain-based auth, no secret-key-in-env.

All three paths return a JSON object with `client_id`. Grab it along with your instance's Frontend API URL (the issuer, e.g. `https://clerk.your-subdomain.accounts.dev` or a custom domain like `https://clerk.yourapp.com`).

### 2. Configure your CLI

```bash
export CLERK_OAUTH_CLIENT_ID="..."   # from step 1
export CLERK_ISSUER="https://clerk.your-subdomain.accounts.dev"
```

## Usage

```ts
import { ClerkCliAuth } from "@clerk/cli-auth";

const auth = new ClerkCliAuth({
	clientId: process.env.CLERK_OAUTH_CLIENT_ID!,
	issuer: process.env.CLERK_ISSUER!,
	scopes: ["profile", "email", "offline_access"],
	storage: "keychain",
	keychainService: "my-cli",
});

// Opens a browser, starts a one-shot localhost listener, exchanges the code,
// stores tokens in the OS keychain. Returns the token set and userinfo.
const { tokens, user } = await auth.login();

// Returns the cached access token; auto-refreshes when within 30s of expiry.
const token = await auth.getAccessToken();

// Reads the cached user. If no cache, fetches from /oauth/userinfo.
const me = await auth.whoami();

// Clears keychain + cached userinfo.
await auth.logout();
```

The import above uses this repo's private package name after you build or vendor it locally. It is illustrative; there is no published `@clerk/cli-auth` package today.

## How the flow works

```
1. CLI generates PKCE (code_verifier, code_challenge=S256(verifier)) + CSRF state.
2. CLI binds a one-shot HTTP server on 127.0.0.1:0 (random port, loopback only).
3. CLI opens browser to:
     {issuer}/oauth/authorize?client_id=...&code_challenge=...
       &redirect_uri=http://127.0.0.1:{port}/callback&state=...
       &code_challenge_method=S256
4. User signs in via Clerk's hosted UI and approves consent.
5. Clerk redirects the browser to http://127.0.0.1:{port}/callback?code=...&state=...
6. Server validates state, responds with "You can close this tab", closes.
7. CLI posts to {issuer}/oauth/token with grant_type=authorization_code + code_verifier.
8. CLI stores the token set in the OS keychain (falls back to chmod 600 JSON file).
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build        # emits dist/index.cjs + dist/index.mjs + .d.ts
```

10 tests across 4 files cover PKCE correctness, localhost server happy path + state mismatch + timeout, credential store round-trips, and end-to-end login against stubbed OAuth endpoints.

## Known limitations

- **No token revocation on logout.** Logout only clears local storage; the refresh token remains valid on Clerk's side until it expires or is explicitly revoked via `/oauth/token/revoke`.
- **Keychain path is tested structurally, not in CI.** Keychain access triggers OS credential-manager prompts in headless environments, so automated tests use memory and file stores. The keychain path does get exercised end-to-end when you run the demo against a real Clerk instance.
- **Device Authorization Grant (RFC 8628) is not implemented.** The localhost-callback flow needs an open port, which doesn't work for CI, containers, or SSH sessions. If you need that, [open an issue](../../issues).
- **Not a product SDK.** This repo intentionally keeps the implementation small so you can inspect and adapt it. A production SDK would likely add token revocation, stronger retry semantics, richer error types, and first-class provisioning guidance.

## License

MIT
