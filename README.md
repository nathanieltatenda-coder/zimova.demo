# ZIMOVA: Move Your Way

Ride-hailing and delivery demo for Zimbabwe: private trips, shared trips, package delivery and rides for someone else, with town-restricted drivers, electronic payments only and an automatic 90% driver / 10% ZIMOVA split.

> **Status: ready for real accounts, payments in TEST MODE.** No demo accounts or demo text remain. Emails and phone numbers are real (you must add email/SMS providers, see `GOLIVE.md`). **Payments are simulated: no real money is charged or paid out**, and the app says so. It is not fully production-ready until the checklist in `DEPLOY.md` is done.

## Quick start
- Copy `.env.example` to `.env` and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (the server will not start the first time without them). Windows: double-click `START_ZIMOVA_WINDOWS.bat`, which creates `.env` and opens it. Anywhere: `npm install`, `npm start`, open http://localhost:3000.
- Upgrading a database that has old test data? Read `GOLIVE.md` and run `npm run golive` (stop the server first).
- Real users need the site hosted online with HTTPS and email/SMS providers: `GOLIVE.md` and `DEPLOY.md`.

## What is included
**Booking:** Private ($1/km), Shared ($0.90/km per passenger, consent + route matching), Package (collection and delivery codes, banned-item checks), For someone else. Real road-distance fares, ride PIN, share-trip link, SOS, ratings with comments.
**Towns:** nine towns with boundary polygons (rough demo shapes, editable in Admin > Towns). Drivers only receive requests whose pickup is inside their approved town.
**Payments:** ledger, signed webhooks, duplicate-payment protection, retries, admin refunds, daily driver payouts, driver wallet, reconciliation. Details and the real-gateway steps are in `PAYMENTS.md`.
**Maps:** Google Maps when keys are set (search, satellite, Routes API fares, live driver tracking, navigation), OpenStreetMap otherwise. Setup is in the Google Maps section of this file.
**Safety and admin:** phone verification, driver document checklist (ID, licence, vehicle registration, insurance) required before approval, complaints / incidents / disputes, passenger and driver suspension, reports, active-trip monitoring, audit log, notifications.
**Premium UI:** splash screen, animated bottom navigation on phones, dark/light mode, animated counters and status stepper, driver-matching animation, success screens, skeleton loaders, smooth modals. Respects "reduce motion".
**Phone apps (Android and iPhone):** a Capacitor wrapper in `mobile/` (generated `android/` and `ios/` projects, icons, build script) with push notifications and background driver tracking. Email and SMS verification, push sending and CORS are built on the server. Read `mobile/MOBILE.md` first.
**Production foundations:** PostgreSQL option, atomic JSON saves with daily backups, security headers, rate limiting, idempotent booking requests, error log, `/healthz`, backup script, automated tests. See `DEPLOY.md`.

## Tests
`npm test` runs 30 integration tests against the real server (payments, webhooks, refunds, payouts, town rules, shared/package flows, privacy, suspension, SMS/email/push sending, CORS, native location uploads). For PostgreSQL: `DATABASE_URL=postgres://... npm test`.

## Files
**New:** `GOLIVE.md`, `scripts/golive.js`, `tests/golive.test.js`, `lib/store.js` (JSON/PostgreSQL storage), `lib/extra.js` (payments, notifications, verification, tickets, admin reports), `lib/messaging.js` (SMS, email, push senders), `mobile/` (Android/iPhone apps and `MOBILE.md`), `public/js/config.js`, `tests/messaging.test.js`, `public/js/maps.js` (Google/OSM map layer), `public/js/ui.js` (premium UI and new screens), `tests/api.test.js`, `scripts/backup.js`, `PAYMENTS.md`, `DEPLOY.md`.
**Changed:** `server.js`, `public/index.html`, `public/css/styles.css`, `public/js/app.js`, `package.json`, `.env.example`, `.gitignore`, `README.md`.
**Your data:** `data/db.json` is upgraded automatically on start (pricing resets to the new rates, approved drivers default to Harare with documents marked verified, passengers must verify their phone and email). Old `@zimova.test` demo accounts are only removed by `npm run golive`. Back it up first.

## Google Maps setup
Works with placeholders: with no keys the app uses OpenStreetMap. To switch on Google Maps:
1. Create a Google Cloud project and **enable billing**. Enable Maps JavaScript API, Places API (New), Geocoding API and Routes API.
2. Create two keys. Browser key: restrict to your website address (and `http://localhost:3000/*` for testing) and to Maps JavaScript, Places (New) and Geocoding. Server key: restrict to your server IP and to Routes API only.
3. Put them in `.env` as `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY`, restart. Set budget alerts and quota caps in Google Cloud.
4. Costs: Google bills per request type with a free monthly allowance for each; prices change, so check https://developers.google.com/maps/billing-and-pricing/pricing and the Google Cloud pricing calculator. Per trip expect roughly 2 map loads, 1 to 4 route quotes, a few reverse-geocode labels and 1 to 2 searches.
The satellite option uses Google's own map type through the Maps JavaScript API (keep the Google logo and attribution visible).

## What still needs outside accounts or work
- **Real payment provider** and its credentials, plus a signed-off way to pay drivers out (`PAYMENTS.md`).
- **SMS, email and push accounts** (adapters exist for Twilio / any JSON SMS API, SMTP and Firebase; none tried against real accounts). **Google Cloud keys** for Google Maps. **Apple and Google developer accounts** and a hosted HTTPS server for the phone apps (`mobile/MOBILE.md`). iPhone push needs one extra Firebase step.
- **Driver document uploads** (needs file storage); today drivers enter numbers and an admin ticks the checklist.
- **Native or installed app** for reliable background GPS tracking.
- Real town boundaries, security review, device testing, load testing and legal/licensing checks (`DEPLOY.md`).
- The Google Maps code path has not been run against real Google services; the server side of it was tested with a stand-in.
