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

## Phase 1 update (demo)

- Fares: private trip $1.00/km (min $1.00). Driver 90%, ZIMOVA 10%, no passenger fee. Shared rate ($0.90/km) is stored in settings; shared trips arrive in phase 2.
- Towns: Harare, Bulawayo, Mutare, Gweru, Masvingo, Kwekwe, Chinhoyi, Karoi, Kariba. Boundaries are rough demo polygons; edit them in Admin > Towns.
- A ride request is only visible to approved, online drivers whose approved town matches the pickup town. Pickups outside an active town are refused.
- Existing data files are upgraded automatically on start (drivers default to Harare; pricing resets to the new rates).
- Still demo: JSON storage (PostgreSQL planned), simulated payments, OpenStreetMap maps (Google Maps planned).

## Phase 2 update (demo)

- Four booking options: Private ($1/km), Shared ($0.90/km per passenger, own route only), Package delivery (rate in Admin > Pricing, default $1/km) and Ride for someone else (private rate).
- Shared matching: same town, pickups within 3 km, destinations within 5 km, seats left (car seats minus the driver). Passengers must consent, and other riders only see a first name. If the driver already accepted, a later match joins that driver automatically.
- Packages: sender/recipient details, category, size, weight, instructions and a no-dangerous-items declaration (also screened for banned words). A collection code (sender to driver) starts the job and a delivery code (recipient to driver) completes it.
- Ride for someone else: the driver sees the rider's name and phone; the booker pays.

## Phase 3: Google Maps (works with placeholders until you add keys)

With no keys the app keeps using OpenStreetMap, so nothing breaks. Add keys to switch on Google Maps.

### Setup
1. Create a project in Google Cloud Console and **enable billing** (Google Maps Platform requires it, even if usage stays inside the free monthly caps).
2. Enable: Maps JavaScript API, Places API (New), Geocoding API, Routes API.
3. Create **two keys**:
   - Browser key, restricted by *HTTP referrers* (your domain, plus http://localhost:3000/* for testing) and limited to Maps JavaScript, Places (New) and Geocoding.
   - Server key, restricted by *server IP address* and limited to Routes API only.
4. Copy `.env.example` to `.env`, fill `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY`, restart the server.
5. Set a budget alert and quota caps in Google Cloud so a bug or abuse cannot create a surprise bill.

The server key is only used on the server (fares use the Routes API driving distance). Only the browser key is sent to the page, which is normal for Maps JavaScript and is why it must be referrer-restricted.

### What it does
- Passenger map with current-location detection (after browser permission), draggable pins, address search, driving route, and a Standard/Satellite toggle (Google's own hybrid map; keep Google's logo and attribution visible).
- Fares use real driving distance from the Routes API (OSRM when no server key).
- Live driver location: the driver's browser sends GPS only while a trip is active; passengers (and a share link) see it animate on the map; it stops and is deleted when the trip ends, and the server refuses location updates without an active trip.
- Drivers get a "Navigate to pickup / destination" button that opens Google Maps turn-by-turn directions.
- Web limitation: a browser only reports GPS while the driver page is open and the screen is on. Reliable background tracking needs a native or installed app later.

### Cost notes (check Google's pricing page before launch; prices and free caps change)
Google bills per request type (SKU) with a separate free monthly allowance for each. At the time of writing the main ones were: Maps JavaScript loads and Geocoding about 10,000 free per month each, then roughly $7 and $5 per 1,000; Routes (Essentials) about 10,000 free then roughly $5 per 1,000. Places search is billed per SKU depending on the fields requested.
Rough usage per trip: about 2 map loads (passenger + driver), 1 to 4 route quotes, a few reverse-geocode labels and 1 to 2 searches. Multiply by expected monthly trips and compare against the current price table at https://developers.google.com/maps/billing-and-pricing/pricing. Use the Google Cloud pricing calculator for a proper estimate.

### Not verified here
I had no Google key, so the Google code path (map drawing, markers, search, satellite toggle) has not been run against real Google services. The server side (Routes request, polyline decoding, live location rules) was tested with a stand-in service. Expect to fix small issues on first run with your key.

## Added demo features (November 2026)
- Passenger fare offers: after the road quote, passengers can enter a proposed total fare or choose suggested offer buttons. The server validates offers between 50% and 200% of the calculated suggested fare and computes the driver/platform split from the accepted offer.
- Driver request cards show the passenger's proposed fare and the driver's estimated earnings before acceptance.
- Existing driver ride controls remain: accept/reject requests, mark arrived, start with the passenger PIN, and complete the trip.
- Existing active-trip location sharing remains enabled only during an active driver trip; passenger tracking refreshes from the server.
- Mapping remains Leaflet + OpenStreetMap with OSRM routing by default; no Google Maps billing is required for this demo configuration.

This is a development demo. Public OSM/Nominatim/OSRM endpoints have usage policies and limits; use an appropriate hosted provider or self-hosted services before production traffic. Payments and live tracking are demo-grade, not production payment or dispatch infrastructure.

## Passenger pickup and destination selection

The passenger must explicitly choose both trip points before ZIMOVA requests a route or displays a fare. The current GPS position is only suggested as a pickup; it is not treated as confirmed. Use the **Choose pickup** / **Choose destination** controls (or focus the matching input), then tap the map or search for a place. The passenger can also drag either marker to adjust the point.


## Passenger booking UX update
- Passenger booking now uses a map-first layout on mobile with a bottom booking sheet.
- The passenger's selected fare offer is submitted to the server as `offerC` and validated server-side against the suggested fare range.
- Eligible drivers in the pickup town see the passenger's proposed fare in their ride requests and can accept or decline.
- Driver matching and availability are based on approved, online drivers; the demo does not fabricate nearby driver offers.

## Driver counteroffers (demo)
Drivers viewing an available request can choose **Counteroffer** and enter an amount in USD. The server validates the amount against 50%-200% of the suggested fare. The passenger sees the driver's proposed amount and can accept or decline it. Accepting assigns that driver and updates the booking fare and driver/platform split; declining leaves the booking open for another driver. This is a demo workflow; payments remain simulated.

## Multiple driver offers (updated demo)

For a searching booking, each eligible approved and online driver in the pickup town can submit one counteroffer. A driver may revise their own pending offer; separate drivers' offers are retained independently. The passenger sees the pending offers together, including available driver name, vehicle and rating details, and can accept one or decline individual offers. Accepting one offer assigns that driver and closes the other pending offers. Drivers cannot accept the booking directly while pending offers are being compared. This is demo functionality backed by the app's current JSON persistence; it is not a production dispatch guarantee.
