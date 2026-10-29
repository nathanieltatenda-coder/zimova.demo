# ZIMOVA — Move Your Way (Web Demo)

This is a browser-based web application, not an Android app. The provided source archive was missing the folder structure expected by its HTML/server; this package puts the files in the correct places so the web app can run locally.

## Quick start on Windows

1. Install **Node.js 18 or newer** from https://nodejs.org/ (choose the LTS version).
2. Extract the whole `ZIMOVA_Website` folder somewhere easy to find.
3. Double-click `START_ZIMOVA_WINDOWS.bat`.
4. On the first run, it installs the Express dependency; this requires internet access.
5. The website should open at **http://localhost:3000**. Keep the command window open while using it.
6. If the browser does not open automatically, copy `http://localhost:3000` into Chrome or Edge.
7. To stop the website, click the command window and press `Ctrl+C`.

## Demo logins

- Admin: `admin@zimova.test` / `admin123`
- Approved demo driver: `driver@zimova.test` / `driver123`
- Passenger: create a new account from the website.

Change demo credentials before sharing this project with anyone. You can copy `.env.example` to `.env` and set `ADMIN_EMAIL` and `ADMIN_PASSWORD`; note that the seeded demo database is only created on the first run. If a database was already created, changing the environment values will not update its existing admin account.

## Project structure

- `server.js` — web server and API; server-side fare calculation and demo account logic.
- `package.json` — Node.js dependencies and start command.
- `public/index.html` — page shell.
- `public/css/styles.css` — website styling.
- `public/js/app.js` — browser interface and interactions.
- `data/db.json` — created automatically at first run to store demo data.
- `START_ZIMOVA_WINDOWS.bat` — Windows launcher.

## What works in the demo

- Responsive ZIMOVA black, white, and gold interface.
- Real OpenStreetMap map tiles (internet required).
- Pickup and destination pins within Zimbabwe.
- Road route and distance calculation using the configured OSRM service.
- Town/address search using OpenStreetMap Nominatim.
- Passenger sign-up and sign-in.
- Driver sign-up, approval status, and online/offline mode.
- Booking request, driver acceptance, arrival, trip start and completion.
- Server-calculated fare, 5% passenger service fee, 5% platform commission, and 95% driver share.
- Simulated payment choices for EcoCash, Visa, and Mastercard; no real money is charged.
- Admin pricing, driver review, booking, revenue, transaction, and audit views supported by the source code.

## Important limitations

- This is a local demonstration, not a publicly hosted production service.
- Payments are simulated. No EcoCash, Visa, or Mastercard transaction takes place.
- Driver document fields are demo confirmations; no identity documents are uploaded or securely verified.
- Live GPS tracking, SMS/OTP, email verification, password reset, and production notifications are not implemented.
- Demo data is stored in a local JSON file and is not suitable for multi-server or production use.
- The public OSRM and Nominatim services are suitable only for light testing and may impose usage limits. Select production mapping/routing services and comply with their policies before launch.
- Do not use real identity, card, or banking details in this demo.

## Fare model

Example defaults: base fare $0.50 + $0.40/km, minimum $1.50; Economy 1.00x, Comfort 1.35x, SUV 1.70x. Driver gets 95% of the original fare, platform commission is 5% of the original fare, and the passenger pays an additional 5% service fee. Admin pricing can adjust the demo rates.

## Troubleshooting

- **`node` or `npm` is not recognized:** install Node.js 18+ and reopen the terminal.
- **Website does not open:** keep the launcher window running and try `http://localhost:3000` manually.
- **Port 3000 is busy:** close another app using it, or set `PORT=3001` in your environment and open `http://localhost:3001`.
- **Map is blank:** check internet access; map tiles and routing are external services.
- **No fare appears:** ensure both pins are inside Zimbabwe and the routing service is responding.

This is a corrected local web package of the supplied ZIMOVA project. Review and test the code before any public deployment.
