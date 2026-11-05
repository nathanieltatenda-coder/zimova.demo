# Using ZIMOVA with real people

ZIMOVA now starts with **no demo accounts, no demo logins and no demo banner**. Real emails and phone numbers work. The one thing that stays in test mode, as you asked, is **payments**.

## Be honest with users about test-mode payments
While `PAYMENT_PROVIDER=sandbox`, no money is charged to passengers and none is paid to drivers. Fares, driver earnings, commission, payouts and refunds are all **records only**. The app shows a small "test mode" notice, receipts say so, and driver wallets say "records only". Please tell your drivers clearly that earnings are not being paid out yet, otherwise they may expect real money. When you connect a real gateway (see `PAYMENTS.md`) the notices disappear.

## First start (new installation)
1. Copy `.env.example` to `.env`. Set `ADMIN_EMAIL` (your real address) and `ADMIN_PASSWORD` (10+ characters, letters and numbers). The server refuses to start without them. On Windows, `START_ZIMOVA_WINDOWS.bat` creates `.env` and opens it for you.
2. Start the server and sign in with those details. Change the password in Profile whenever you like.
3. Open Admin > Reports: the **Setup status** card shows what is still to do.

## Existing installation with old test data
1. **Stop the server.** 2. Run `npm run golive`. It writes a backup first, then asks whether to remove the old test accounts (`@zimova.test`), delete all test trips/payments/reports, and (optionally) delete every other account so only the admin remains. It sets your real admin account. You must type RESET to apply. 3. Start the server.
Non-interactive use is described at the top of `scripts/golive.js`.

## Real emails and phone numbers: what you must set up
Verification codes can only reach real people through a provider. Without one, **in production nobody can verify** (the on-screen test codes are switched off on purpose).
- **Email** (also used for password reset): set `EMAIL_PROVIDER=smtp`, `SMTP_URL` and `EMAIL_FROM` in `.env`. An easy start is a normal mailbox through its SMTP settings (for example a Google Workspace or Gmail account with an app password, as far as I know with daily sending limits). Check that the codes do not land in spam; set up SPF/DKIM if you use your own domain.
- **SMS**: set `SMS_PROVIDER=twilio` (or `http` for any provider with a simple JSON API). **Check the provider delivers to Zimbabwean numbers, which sender names are allowed, and the price per message before you rely on it.**
- **Until SMS is ready:** you can set `REQUIRE_PHONE_VERIFICATION=0` (people can book without a verified number; weaker, because anyone can type any number), or verify people yourself in Admin > Passengers ("Mark verified" for phone and email). Setting `REQUIRE_EMAIL_VERIFICATION=0` does the same for email.

## Protect the real data you are about to collect
- The system stores names, phone numbers, emails, trip history, driver ID/licence/insurance **numbers** and driver locations during trips. Use **PostgreSQL**, **HTTPS**, strong passwords, daily off-server backups and keep the server up to date (`DEPLOY.md`).
- Passengers and drivers need a **privacy policy and terms of service** before they sign up. I have not written these: they must be reviewed by a qualified local adviser, who can also tell you which Zimbabwean data-protection, transport-licensing and business rules apply.
- A website on your own computer is only reachable by you. Real users need it hosted online with HTTPS (`DEPLOY.md`).
