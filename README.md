# Just Call Moe VIP Portal Beta

This folder contains a mobile-first Just Call Moe VIP client portal and an admin dashboard. The static prototype still works, and `server.mjs` adds the first beta layer: persisted VIP records, claim-code login, admin authentication, CSV import, Eventbrite link management, and concierge requests.

## Local Beta Test

1. Copy `.env.example` to `.env` and change `VIP_ADMIN_PASSWORD`.
2. Start the beta server:

```sh
node server.mjs
```

3. Open the member app at `http://127.0.0.1:8787/index.html`.
4. Open the admin dashboard at `http://127.0.0.1:8787/admin.html`.

For local testing, claim codes are shown in the member app after a matching VIP record is found. Set `VIP_SHOW_CODES=false` when you are ready to test real delivery.

## Current Beta Flow

- Members claim with email or phone plus last name.
- Admins sign in with `VIP_ADMIN_PASSWORD`.
- Admins can add VIPs, import CSV rows, publish Eventbrite links, and review concierge requests.
- Member card names and concierge requests persist in `data/vip-db.json`.
- Concierge requests submit through the beta server. When SendGrid is configured, they email `vip@justcallmoe.com` without opening the user's mail app.
- Set `SENDGRID_API_KEY`, `VIP_FROM_EMAIL`, and `VIP_REQUEST_EMAIL` in `.env` to turn on automatic email delivery.

## Next Production Step

Before inviting a larger beta group, replace the local JSON store and visible local codes with hosted services: Supabase/Postgres for data, production email/SMS code delivery, monitored concierge email delivery, and a deployed HTTPS URL.

Files:

- `index.html` - clickable mobile portal mockup
- `styles.css` - responsive visual styling
- `app.js` - member app navigation and prototype interactions
- `server.mjs` - dependency-free local beta server and API
- `admin.html` - admin dashboard prototype
- `admin.css` - admin dashboard styling
- `admin.js` - admin dashboard interactions
- `.env.example` - local beta configuration template
- `PRODUCT_BRIEF.md` - MVP scope, admin needs, security notes, and build phases
- `assets/just-call-moe-vip-card.png` - VIP card graphic used in the prototype
