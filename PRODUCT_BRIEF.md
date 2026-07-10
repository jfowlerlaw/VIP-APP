# Just Call Moe VIP Portal Product Brief

Source program page: https://justcallmoe.com/join-the-just-call-moe-vip-program-today/

## Product Direction

Build a mobile-first VIP member portal that gives clients a virtual VIP card and one place to access their Just Call Moe VIP benefits.

The best first release is a secure mobile web app with optional wallet pass support. The VIP card should feel special and branded, but it does not need scanning or verification infrastructure at launch. A native iOS/Android app can come later after the firm sees how VIP clients use the portal.

## Program Benefits To Support

The page describes the VIP program around these member benefits:

- Personalized concierge service for legal questions and concerns
- Members-only phone and email access
- Merchandise discounts at Shop.JustCallMoe.com
- Early alerts for free merchandise
- Invitations to VIP events at local restaurants and JustCallMoe.com parties
- Access to a members-only Just Call Moe VIP Facebook group

## MVP Client Experience

The first version should include:

- Claim flow where VIPs enter email plus last name, receive a verification code, and open their card
- Digital VIP card with the member name rendered on the card graphic in an etched style, plus member ID and VIP status
- Apple Wallet and Google Wallet pass delivery
- VIP snapshot showing next invite and concierge availability
- VIP perks screen for discounts, free merch alerts, and private group access
- Events screen with upcoming event details and direct links to Eventbrite registration
- Concierge screen with members-only phone, email, request form routed to vip@justcallmoe.com, and request status history
- Profile screen for card name, communication preferences, and wallet auto-updates

## MVP Staff/Admin Experience

The firm also needs an admin dashboard. Without it, the app becomes hard to operate.

Admin users should be able to:

- Import VIP records from Google Sheets or CSV
- Add, edit, search, delete, and deactivate VIP members
- Generate a unique VIP card and optional wallet pass for each member
- Send invite links by email or SMS
- Create and publish VIP perks
- Create, curate, and delete event listings with attached Eventbrite URLs
- View concierge requests and assign staff follow-up
- Export member lists and event interest/activity where needed

The prototype admin dashboard is available at `admin.html`.

## Recommended Build Approach

Phase 1: Clickable mockup and product decisions

- Finalize brand styling, card design, and exact VIP workflows
- Decide whether the first launch is invite-only, referral-based, or open signup with approval
- Confirm the tone of the card: symbolic VIP status, appreciation, and easy access to perks

Phase 2: Mobile web MVP

- Build a secure member portal and staff dashboard
- Add login by magic link or SMS code
- Launch digital card, perks, events, concierge, and profile screens
- Track basic analytics: active members, Eventbrite link taps, wallet adds, perk taps, concierge requests

Phase 3: Wallet passes

- Create Apple Wallet and Google Wallet passes
- Support pass updates when membership status, event access, or benefits change
- Keep the pass focused on brand, status, member ID, and quick access links unless scanning becomes useful later

Phase 4: Native app decision

- Build a native app only if push notifications, app store presence, biometric login, or deeper personalization become important enough to justify the extra cost.

## Security And Legal Guardrails

- Use role-based access for admin users.
- Keep a staff audit trail for membership status changes, Eventbrite link taps, perk updates, and concierge request handling.
- Add clear language that the portal is not for emergencies.
- Separate VIP program support from formal legal intake where needed.
- Encrypt member contact data and secure all admin routes.
- If scanning is added in a later version, use a revocable lookup token rather than exposing personal or legal details.

## Suggested Stack

A practical MVP stack:

- Frontend: Next.js or React Native Web/PWA
- Backend: Supabase, Firebase, or a custom Node/Rails/Laravel backend
- Auth: email OTP/magic link plus optional SMS verification
- Database: Postgres
- Admin: protected web dashboard
- Wallet: PassKit for Apple Wallet and Google Wallet API
- Messaging: SendGrid/Mailgun for email to vip@justcallmoe.com and Twilio for SMS
- Import: Google Sheets API or CSV upload into the member database

## First Data Model

Core records:

- `members`: first name, last name, email, city, VIP status, member ID
- `member_imports`: source, uploaded by, row count, imported timestamp, skipped duplicates
- `wallet_passes`: member ID, pass serial, platform, status
- `perks`: title, description, code, visibility, publish dates
- `events`: title, date, location, image, Eventbrite URL, visibility
- `event_clicks`: member ID, event ID, clicked timestamp
- `requests`: member ID, category, message, email destination, staff owner, status
- `admin_users`: user, role, permissions

## Open Decisions

- What exact wording makes the symbolic VIP card feel most personal and appreciated?
- Should members join directly from the website, or should staff approve them first?
- Does the private Facebook group stay outside the portal, or should community posts eventually appear in-app?
- Which staff members need admin access and what roles should they have?
