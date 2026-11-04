# Deploying ZIMOVA

This build is a working demo with production-style foundations. It is **not production-ready** until the checklist at the bottom is done (real payments, SMS, tested on real phones, security review).

## Minimum setup on a server (Ubuntu example)
1. Install Node 18+ and PostgreSQL. Create a database and user, then set `DATABASE_URL`.
2. Copy the project, run `npm install --omit=dev`, copy `.env.example` to `.env` and fill it in. Set `NODE_ENV=production`, `TRUST_PROXY=1`, `FORCE_HTTPS=1`, a strong `ADMIN_PASSWORD` (first start only, change it after) and `PAYMENT_WEBHOOK_SECRET`.
3. Run under a process manager (`pm2 start server.js --name zimova` or a systemd service) so it restarts after crashes and reboots.
4. Put Caddy or nginx in front for **HTTPS** (Caddy gets certificates automatically): proxy your domain to `127.0.0.1:3000` and pass `X-Forwarded-Proto`.
5. Hosted alternative: Render/Railway/Fly with a managed PostgreSQL; set the same environment variables.

## Data and backups
- PostgreSQL mode stores each collection (users, bookings, payments...) as a JSONB row in `zimova_state`. It is durable and transactional but not yet normalised into relational tables; plan that migration before large scale.
- `npm run backup` writes a dump (pg_dump) or JSON copy to `backups/`. Run it daily from cron **and copy it off the server**. Also enable your database host's automatic backups and test a restore.

## Monitoring and logs
- `GET /healthz` returns 200 when the app and database respond: point UptimeRobot or similar at it.
- Errors go to `logs/error.log` (JSON lines). Admin metrics: `GET /api/admin/metrics`. Add an error tracker (e.g. Sentry) and log shipping when you have real users.
- Reconcile payments weekly: Admin > Payments.

## Scaling notes
- Run **one instance** for now: rate limits, idempotency cache and live driver positions are kept in memory. For several instances, move those to Redis/PostgreSQL and use WebSockets or server-sent events instead of 3-second polling.
- Live driver location only reports while the driver's browser page is open. Reliable background tracking needs a native or installed app.

## Go-live checklist (not done yet)
- [ ] Real payment gateway adapter, tested end to end (see PAYMENTS.md)
- [ ] Real SMS provider for phone verification (`SMS_PROVIDER`)
- [ ] Google Maps keys with restrictions, billing alerts and quota caps (see README)
- [ ] Document upload and storage for driver documents (currently numbers + admin checklist)
- [ ] Content-Security-Policy and further headers set at the proxy; dependency audit (`npm audit`); a security review or penetration test
- [ ] Test on several Android phones and desktop browsers, on slow networks
- [ ] Load test the busiest flows (quote, booking, polling)
- [ ] Business registration, transport licensing, insurance, terms of service and privacy policy reviewed by qualified local advisers
