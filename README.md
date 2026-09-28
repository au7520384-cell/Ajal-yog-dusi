# 🎱 Bilyard 8 — Masters League

An 8-ball pool game for phones and computers. The game is `index.html`; the online part (real opponents, friends, invite bonuses, global leaderboard, real-money purchases) is the small Node.js server in `server/`.

## Features
- **Always landscape and full screen:** on the first tap the game goes full screen and locks to landscape. On phones that can't lock (iPhone Safari), the game rotates itself. When installed as an app (PWA), it opens full screen in landscape.
- **Languages:** O'zbekcha / English / Русский (🌐 button; picked automatically from the device language).
- **Online 1 on 1:** real players are matched per city. Both devices get the same rack, shots and aim are streamed live, and chat works between players. If nobody is found within 15 s, a computer opponent (marked 🤖) plays instead.
- **Friends:** each player has a unique ID code. You can add friends by code, send one gift a day to each friend, request gifts, and see who is online.
- **Invite bonus:** the inviter gets 💵 25 + 🪙 15 000 and the invited friend gets 💵 10 + 🪙 5 000. It works with an invite link (`?ref=CODE`) or by entering the code in the first 7 days.
- **Global leaderboard:** real players ranked by coins won.
- **Expensive economy:** 10 cities, from Toshkent (50 coins) to Las-Vegas (50 000 000 entry / 100 000 000 prize). Coin cues go up to **5 billion**; premium cash (💵) cues go up to **1 500 cash**. Cash is hard to earn (1–5 at a time).
- **Bank:** buy cash or coins with real money (Stripe), or exchange cash for coins.
- **Gameplay:** 3D rolling balls, spin, synthesized click sounds, 3D cues, a tournament bracket, the daily reward route, lucky shot, wheel, watch mode, achievements, and levels.

## Run it yourself
```bash
cd server
npm install
npm start            # http://localhost:8080
```
Open `http://localhost:8080` and the game connects to the server automatically. Opening `index.html` as a plain file also works, but online features are then off.

## Put it on the internet for free (Render + Neon)
Player data is stored in Postgres when `DATABASE_URL` is set; without it the server uses a JSON file (local use).
1. **Database:** create a free project at neon.tech and copy the connection string (`postgresql://…?sslmode=require`). The server creates its tables itself.
2. **Server:** on render.com choose **New → Blueprint** and pick this repo. `render.yaml` sets everything up (free plan, root `server`).
3. Fill in `DATABASE_URL` (the Neon string) and `APP_URL` (`https://bilyard8.onrender.com`). Leave the Stripe keys empty for now.
4. The log should say `storage postgres`. Open the URL and play.

The free Render plan sleeps after ~15 minutes without visitors; the first visitor then waits about 30 s. Data is safe in Neon either way. A paid instance removes the sleep.

### Real-money payments (Stripe)
1. Create a Stripe account and get your **Secret key**.
2. Add a webhook endpoint `https://your-domain/api/stripe/webhook` for the event `checkout.session.completed` and copy its **signing secret**.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the server.

Prices live in `SKUS` in `server/server.js` (the server is the source of truth). Purchases are credited to the player's account by the webhook, and the game picks them up automatically.

> ⚠️ **App stores:** if you publish to Google Play or the App Store, their rules require their own in-app billing for digital goods (Google Play Billing / Apple IAP), not Stripe. Stripe is fine for the web version.

## Before a large launch
- The server keeps all players in memory and saves changed rows to Postgres every 2 s — fine for tens of thousands of players on one instance.
- Coins earned in matches are currently counted by the player's device. For a competitive economy, make the server the authority for match results and balances.
- Add a Privacy Policy and Terms of Service page (required by the stores and by Stripe).

## Controls
- **Aim:** drag anywhere on the table and the cue turns with your finger. A quick tap aims at the tapped point.
- **Fine aim:** use the ANIQ/FINE wheel, the mouse wheel, or ←/→.
- **Shoot:** pull the power bar down and release, or hold **Space**.
- **Spin:** tap the white ball in the top-right corner.
