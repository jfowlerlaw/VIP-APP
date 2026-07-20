# Just Call Moe VIP Portal Beta

This folder contains a mobile-first Just Call Moe VIP client portal and an admin dashboard. The static prototype still works, and `server.mjs` adds the first beta layer: persisted VIP records, claim-code login, member password login, admin authentication, CSV import, Eventbrite link management, and concierge requests.

## Local Beta Test

1. Copy `.env.example` to `.env` and change `VIP_ADMIN_PASSWORD`.
2. Start the beta server:

```sh
node server.mjs
```

3. Open the member app at `http://127.0.0.1:8787/index.html`.
4. Open the admin dashboard at `http://127.0.0.1:8787/admin.html`.

For local testing, claim codes are shown in the member app after a matching VIP record is found. Set `VIP_SHOW_CODES=false` when you are ready to test real email delivery.

## Current Beta Flow

- Members claim with email plus last name, receive a verification code, then can create a password in Profile.
- Returning members with a saved password can sign in with email plus password instead of getting a code every time.
- Admins sign in with `VIP_ADMIN_PASSWORD`.
- Admins can add VIPs, import CSV rows, publish Eventbrite links, and review concierge requests.
- Member card names and concierge requests persist in Supabase when configured, otherwise in `data/vip-db.json`.
- Verification codes, password login, and concierge requests submit through the beta server. When SendGrid is configured, verification codes email the VIP and concierge requests email `vip@justcallmoe.com` without opening the user's mail app.
- Set `SENDGRID_API_KEY`, `VIP_FROM_EMAIL`, and `VIP_REQUEST_EMAIL` in `.env` to turn on automatic email delivery.
- In Render, set `VIP_SHOW_CODES=false` once `SENDGRID_API_KEY` is configured so real testers receive emailed random codes instead of seeing the beta code on screen.

## Supabase Database Setup

The app can use Supabase/Postgres for beta data without changing the frontend. If `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are present in `.env`, the server uses Supabase. If they are blank, it falls back to the local JSON file.

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run the SQL in `supabase/schema.sql`.
4. In Supabase, copy your project URL and a backend secret key.
5. Add these to `.env`:

```sh
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=your-backend-secret-key
```

Keep `SUPABASE_SECRET_KEY` server-side only. Do not paste it into browser code, GitHub, or a public document.

For Render, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as environment variables on the web service. They are listed in `render.yaml` as `sync: false` so the real values stay out of GitHub.

To import the existing VIP Google Sheet, export the sheet as CSV and upload it from the admin dashboard import panel. The most important columns are:

- `first_name`
- `last_name`
- `email`
- `city`
- `status`

Optional helpful columns are `id`, `name`, `card_name`, `phone`, `member_id`, and `joined`. If the sheet does not already have IDs, Supabase will generate them. If `name` and `card_name` are blank, Supabase will build them from `first_name` and `last_name`.

Password login uses the `password_hash` and `password_set_at` columns in `supabase/schema.sql`. Existing Supabase projects can rerun the schema safely because the member-table additions use `add column if not exists`.

The admin importer also accepts common name-header variations such as `First`, `Last`, `First Name`, and `Last Name`.

Example:

```csv
first_name,last_name,city,email,status
Taylor,Brooks,Orlando,taylor@example.com,Unclaimed
Morgan,Lee,Tampa,morgan@example.com,Unclaimed
```

## Next Production Step

Before inviting a larger beta group, finish Supabase setup, import the VIP list, confirm password setup works after verification, monitor concierge email delivery, and deploy the app to an HTTPS URL.

Files:

- `index.html` - clickable mobile portal mockup
- `styles.css` - responsive visual styling
- `app.js` - member app navigation and prototype interactions
- `server.mjs` - dependency-free local beta server and API
- `database.mjs` - local JSON/Supabase database adapter
- `admin.html` - admin dashboard prototype
- `admin.css` - admin dashboard styling
- `admin.js` - admin dashboard interactions
- `.env.example` - local beta configuration template
- `supabase/schema.sql` - Supabase/Postgres table schema
- `PRODUCT_BRIEF.md` - MVP scope, admin needs, security notes, and build phases
- `assets/just-call-moe-vip-card.png` - VIP card graphic used in the prototype
