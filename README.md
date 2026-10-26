# Habit ledger

A habit tracker styled as an accounting ledger. Accounts, email confirmation, password reset, Google sign-in, and Postgres or file storage. Node 18+.

## Run locally

    npm install        # only needed for Postgres (installs "pg")
    npm start          # http://localhost:3000
    npm test           # 54 end-to-end checks against fake email and Google servers

Locally, with no email provider set, confirmation and reset emails are printed to the terminal, so you can click through every flow.

## Deploy

    docker build -t habit-ledger .
    docker run -d -p 3000:3000 -e TRUST_PROXY=1 -e BASE_URL=https://habits.example.com \
      -e DATABASE_URL=postgres://user:pass@host/db \
      -e RESEND_API_KEY=... -e MAIL_FROM="Habit ledger <no-reply@yourdomain.com>" \
      -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... habit-ledger

Serve it over HTTPS (your host or proxy). Health check: `GET /healthz`.

| Variable | Needed for | Notes |
|---|---|---|
| `NODE_ENV=production` | all | Secure cookies, HSTS, no dev email printing |
| `BASE_URL` | email, Google | Public address with no trailing slash. Used in email links and the Google redirect |
| `TRUST_PROXY=1` | behind a proxy | Rate limits use the real client IP |
| `PORT` | | Default 3000 |
| `DATABASE_URL` | Postgres | Without it, data goes to a JSON file in `DATA_DIR` (one instance only) |
| `PGSSL=require` | some hosts | Turns on TLS for the database connection |
| `DATA_DIR` | file store | Mount a persistent disk. Default `./data` |
| `RESEND_API_KEY`, `MAIL_FROM` | email | Resend API. `MAIL_FROM` must be on a domain you verified there |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google | See below |

Features switch themselves on when configured. With no email settings in production, the "Forgot password" link and the confirm-your-email banner are hidden. With no Google settings, the Google button is hidden.

## Postgres

Set `DATABASE_URL`. Tables (`users`, `sessions`, `tokens`) are created on first start. To move existing file-store users, ask for a one-off import script. To check your database wiring, run `DATABASE_URL=<a scratch database> npm test`.

## Google sign-in

1. In Google Cloud Console, open APIs & Services, Credentials, and create an OAuth client ID (type: Web application).
2. Add the authorized redirect URI `https://YOUR-DOMAIN/auth/google/callback` (must match `BASE_URL` exactly).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Google accounts are matched by Google ID, then by email. If a Google sign-in matches an account whose email was never confirmed, that account's password is removed and its sessions end. This blocks anyone who pre-registered someone else's email.

## Email

Uses the Resend HTTP API (no extra packages). To use another provider, edit `mail()` in `server.js`. Confirmation links last 24 hours, reset links one hour, and both work once. Tokens travel in the URL fragment (`/#reset=...`), so they are not sent to the server in page requests or logs. Only a SHA-256 of each token is stored.

## Security notes

scrypt password hashing, HttpOnly SameSite session cookies, rate limits on every account endpoint, strict CSP (scripts from this origin only), cross-origin write blocking, server-side validation of all saved data. Password reset ends all other sessions.

## Known limits

- Rate limits live in memory, so they reset on restart and are per server process. Put a gateway limit in front if you run several instances.
- Unconfirmed accounts can still use the app. The banner nags but does not block.
- The Postgres adapter was checked with a stubbed driver (query shapes only), not against a live database. Run `DATABASE_URL=... npm test` once before launch.
- No two-factor sign-in, no account email change, no admin tools.
- Back up your database or `DATA_DIR`.
