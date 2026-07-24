# OAuth setup (local development)

Blitz It signs users in with **GitHub** and **Google** only (Better Auth, per
[`DECISIONS.md`](./DECISIONS.md) D3). The app runs fine without these — the login page simply
reports that no providers are configured — so you can do this whenever you're ready.

Providers are registered **only when both the id and secret are present**, so you can enable
just one to start.

---

## 1. GitHub OAuth app

1. Go to **https://github.com/settings/developers** → *OAuth Apps* → **New OAuth App**.
   (Or: GitHub → Settings → Developer settings → OAuth Apps.)
2. Fill in:
   | Field | Value (local) |
   |-------|----------------|
   | Application name | `Blitz It (local)` |
   | Homepage URL | `http://localhost:3000` |
   | Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy it immediately (shown once).

Add to `.env.local`:
```bash
GITHUB_CLIENT_ID=Ov23li...your-id
GITHUB_CLIENT_SECRET=your-secret
```

## 2. Google OAuth client

1. Go to **https://console.cloud.google.com/**.
2. Create (or select) a project — e.g. `blitz-it`.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: `Blitz It`, add your email as support + developer contact
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough
   - Add your own Google account under **Test users** while the app is unpublished
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   | Field | Value (local) |
   |-------|----------------|
   | Application type | Web application |
   | Name | `Blitz It (local)` |
   | Authorized JavaScript origins | `http://localhost:3000` |
   | Authorized redirect URIs | `http://localhost:3000/api/auth/callback/google` |
5. Copy the **Client ID** and **Client secret**.

Add to `.env.local`:
```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
```

## 3. Auth secret

Required in **production**; development falls back to a built-in dev secret automatically.

```bash
# generates a 32+ char secret
openssl rand -base64 32
```

```bash
BETTER_AUTH_SECRET=<paste here>   # min 32 chars
BETTER_AUTH_URL=http://localhost:3000
```

## 4. Restart

Env is read at boot, so restart the dev server:

```bash
npm run dev
```

Visit http://localhost:3000/login — the configured buttons appear.

---

## Callback URL reference

Better Auth mounts at `/api/auth/*`. The callback path is
`/api/auth/callback/<provider>`:

| Environment | GitHub | Google |
|---|---|---|
| Local | `http://localhost:3000/api/auth/callback/github` | `http://localhost:3000/api/auth/callback/google` |
| Production | `https://<your-domain>/api/auth/callback/github` | `https://<your-domain>/api/auth/callback/google` |

**Use separate OAuth apps per environment** — never share local and production credentials
(coding standard: separate secrets per environment).

## Troubleshooting

| Symptom | Cause |
|---|---|
| "No sign-in providers configured" | Both id and secret must be set for a provider; restart after editing `.env.local`. |
| `redirect_uri_mismatch` | The callback URL in the provider console must match exactly, including scheme, port, and path. |
| Google "access blocked" | While the consent screen is unpublished, your account must be listed under **Test users**. |
| Signed in but 403 on `/admin` | Admin is a domain role — promote yourself with `npm run make:admin <email>`. |
