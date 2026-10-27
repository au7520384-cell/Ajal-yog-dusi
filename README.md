# 🎱 Royal Billiard 8 — Masters League

An 8-ball pool game for phones and computers. The game is `index.html`; the online part (real opponents, friends, invite bonuses, global leaderboard, real-money purchases) is the small Node.js server in `server/`.

## Features
- **Always landscape and full screen:** on the first tap the game goes full screen and locks to landscape. On phones that can't lock (iPhone Safari), the game rotates itself. When installed as an app (PWA), it opens full screen in landscape.
- **Languages:** O'zbekcha, English, Русский, Türkçe, Español, Português, Français, Deutsch, Bahasa Indonesia, العربية, हिन्दी, 한국어, 日本語, 中文 (🌐 button). Picked automatically from the player's device language, or from their country (found from the device time zone) when the device is set to English. Everything on screen follows the chosen language — menus, settings, popups, toasts, tutorial, in-game banners, names on the tables and in the leaderboards' default player names — so no word is left in Uzbek. To add or change a text: put a line `uz key‖en|ru|tr|es|pt|ar|id|hi|fr|de|ko|ja|zh` into `tools/xt.txt` and run `python3 tools/build_i18n.py`. Server announcements (`/admin/news`, `POST /api/news/post`) may carry per-language texts in an optional `i18n` object (`{"en": {"title", "text", "btn"}, "de": {…}}`); a language without its own copy falls back to English.
- **Country:** detected automatically (time zone, then browser region) and shown as a flag on the leaderboards; players can change it in the profile.
- **Online 1 on 1:** real players are matched per city. Both devices get the same rack, shots and aim are streamed live, and chat works between players. If nobody is found within 15 s, a computer opponent (marked 🤖) plays instead.
- **Friends:** each player has a unique ID code. A friend code or a name in *Suggested friends* sends a **friend request** — the other player gets a pop-up with **Accept / Decline** (declined: nothing is added and nothing is said; accepted: both appear in each other's friend list, and the asker is told). **Share** opens Telegram's chat picker inside the Mini App (the link `t.me/<bot>/<app>?startapp=f_CODE` makes a new player a friend at once, with the invite bonus; anybody else sends a request). Friends can **chat** (pop-up with quick phrases, unread badges, swear filter, 80 messages / 60 days kept per pair) and start a table together with one tap; one gift a day to each friend, gift requests, and who is online (active in the last 2½ minutes). **Bot messages:** a player who signed in through the Mini App and allowed it (Telegram's pop-up, asked once when the Friends screen opens; or `/start` in the bot chat) gets a message from the bot — in their game language, with a button that opens the right screen — when they are away from the game and someone sends a friend request, accepts theirs, writes to them, or invites them to a table (friends only). At most 15 a day, one per sender per few minutes, nothing while the game is open; switch off in Settings → *Notifications in Telegram* or with `/stop`; a blocked bot is skipped.
- **Invite bonus:** the inviter gets 💵 25 + 🪙 15 000 and the invited friend gets 💵 10 + 🪙 5 000. It works with an invite link (`?ref=CODE`) or by entering the code in the first 7 days.
- **Weekly leaderboards (like 8 Ball Pool):** My League / Friends / Country / World tabs, ranked by coins won this week (Monday–Sunday UTC). Prizes for the world top 3 each week: 💵 1500 / 750 / 400.
- **Leagues:** Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster. Everyone starts in Bronze; each week the top 20% of a league move up and the bottom 20% move down.
- **322 cues in 5 tabs** (every generated cue has its own colour and pattern pair; a cue button next to the spin ball lets you switch or buy cues during a match): Standard (coins or cash), Victory (collect 4 pieces by winning in a city or higher), Surprise (legendary cues, pieces from Surprise Boxes), Country (a flag cue for each of 199 countries) and Owned. Collection power grows with every cue.
- **Avatars and frames:** 100 avatars (20 free, the rest for coins or cash) and 9 avatar frames.
- **Expensive economy:** 18 cities like 8 Ball Pool — London, Sydney, Lisbon, Tokyo, Las Vegas, Jakarta, Toronto, Cairo, Dubai, Shanghai, Paris, Rome, Bangkok, Seoul, Mumbai, Berlin, Istanbul, Osaka (100 000 000 entry / 200 000 000 prize).
- **Tournaments:** Asia Cup (32 players), South America Cup (32), Europe Cup (48), World Cup (60) — knockout brackets with byes, 5–6 rounds.
- **Clubs** (unlocked at level 6): create or join a club (up to 50 members), club chat, members ranked by weekly winnings; members of the week's top 3 clubs get 💵 50 / 25 / 10.
- **Season pass ("King's Gambit"):** a monthly season with 30 tiers, a free and a premium track (300 cash), daily missions, exclusive cues and frame.
- **Cloud save:** the whole progress is saved on the server (Postgres) a few seconds after every change and when the page is hidden; a newer save on the server is restored on start. Settings → *Get key* gives a recovery key; on a new phone *Restore* with the ID + key signs in to the same account.
- **Settings:** sound, vibration, cue sensitivity, tap to aim, aiming wheel, guideline in offline games, power bar side, cheering, friend requests, online status, friend-online notifications. Coin cues go up to **5 billion**; premium cash (💵) cues go up to **1 500 cash**. Cash is hard to earn (1–5 at a time).
- **Currencies:** coins, cash and gems, with the game's own artwork.
- **Shop:** Special Offers (starter pack, gem packs), Coins & Cash packs with bonus ribbons and VIP points, Free Rewards, Minigames, Cues & More. Real money via Stripe; cash→coins and gems→cash exchange.
- **Gameplay:** 3D rolling balls, spin, synthesised pool sounds tuned to real recordings, 3D cues, a tournament bracket, the daily reward route, lucky shot, wheel, watch mode, achievements, and levels.

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
3. Fill in `DATABASE_URL` (the Neon string) and `APP_URL` (`https://billiard8.onrender.com`). Leave the Stripe keys empty for now.
4. The log should say `storage postgres`. Open the URL and play.

The free Render plan sleeps after ~15 minutes without visitors; the first visitor then waits about 30 s. Data is safe in Neon either way. A paid instance removes the sleep.

## Publish on Y8.com
The game has the Y8 SDK built in (login, cloud save, ads, leaderboard, achievements). It stays off until you fill in `CONFIG` at the top of the script in `index.html`:
```js
const CONFIG = {
  server: "https://billiard8.onrender.com",   // your Render URL (online play from Y8)
  y8AppId: "…",                               // https://account.y8.com/applications/ → create an app
  y8GameId: "…",                              // sent by the Y8 team after approval (ads)
  y8Leaderboard: "Leaderboard",
};
```
In the Y8 dashboard create a leaderboard table named `Leaderboard` and these achievements (key → name):
`first_win` First Win · `double` Double Pot · `breakpot` Power Break · `runout` Clean Table · `champ` Tournament Champion · `lucky` Bullseye · `streak7` Loyal Player · `rich` Rich · `collector` Collector.

What the game does with it: logs the player in (their Y8 name, progress saved to Y8 cloud), shows an interstitial ad after every 2nd match (at most every 90 s), offers rewarded ads (+1 cash in the bank, +1 lucky shot and +1 wheel spin in minigames; 10 per day), submits total winnings to the Y8 leaderboard and awards achievements. On Y8 the Stripe packs are hidden; online play, friends and our global leaderboard still use your Render server.

Upload a zip with `index.html` and `icon.svg` at its root.

### Real-money payments (Paddle — preferred; works for sellers where Stripe is unavailable)
Paddle is the merchant of record (takes the card payment, handles tax, pays you out). The server builds each transaction itself from the SKU price, so no products need to be created in the Paddle catalog.
1. Paddle → Developer tools → Authentication: create an **API key** (permissions: Transactions, Customers, Addresses, Prices, Products read+write; Notifications read) and a **client-side token**.
2. Paddle → Developer tools → Notifications: add a destination `https://your-domain/api/paddle/webhook` for the event `transaction.completed` and copy its **secret key**.
3. Set on the server: `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET` (live) — or the same names ending in `_SANDBOX` for testing (sandbox is used when no live key is set, or when `PADDLE_ENV=sandbox`).
4. Checkout opens from `/pay?_ptxn=…` (served by the game server; the domain must be approved in Paddle → Checkout settings for live payments). If Paddle is configured it is used instead of Stripe.

### Real-money payments (Stripe, alternative)
1. Create a Stripe account and get your **Secret key**.
2. Add a webhook endpoint `https://your-domain/api/stripe/webhook` for the event `checkout.session.completed` and copy its **signing secret**.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the server.

Prices live in `SKUS` in `server/server.js` (the server is the source of truth). Purchases are credited to the player's account by the webhook, and the game picks them up automatically.

> ⚠️ **App stores:** if you publish to Google Play or the App Store, their rules require their own in-app billing for digital goods (Google Play Billing / Apple IAP), not Stripe. Stripe is fine for the web version.

### Telegram payments (inside the Mini App)
- **Stars** (default, always on when `TELEGRAM_BOT_TOKEN` is set): `POST /api/stars/invoice`; `STARS_PER_USD` (default 55) sets the price.
- **Card provider through Telegram Payments** (GlobalPay, ...): off until `TG_PAY_TOKEN` is set in Render. It is the provider token BotFather shows under *Payments* - **use the provider's TEST token first** (no real money). Then the buy button in Telegram asks "Stars or card" and `POST /api/tgpay/invoice` makes the invoice. `TG_PAY_CURRENCY` (default `UZS`) and `TG_PAY_PER_USD` (default 12700; the card price is rounded to whole 100 so'm) set the price. Telegram's own rules say digital goods in bots / Mini Apps are sold with Stars: check them before putting a live token in.

### Card-to-card payments (a transfer to the shop's own card, no payment provider)
In Telegram the buy button also offers "Card transfer" and / or "Via ATM" when these are set in Render (both OFF otherwise):
- `P2P_CARD` - the card number players pay to. Several cards (up to 4, e.g. Humo + Uzcard) go in one value separated by commas: `9860 1606 4515 2044|Aziz A., 8600 1111 2222 3333` (`number|name` gives a card its own holder name; the kind - Humo / Uzcard / Visa / Mastercard - is shown from the first digits). `P2P_HOLDER` - the name shown under cards without their own (optional). **Who sees which card:** `number|name|uz`, `|world` or `|all`; by default Humo / Uzcard are shown to players in Uzbekistan (or with no country set) and Visa / Mastercard to players of every other country. A foreign card works with the receipt flow only (the price is shown in dollars, the admin confirms): money from abroad never arrives as one exact so'm amount, so it cannot be matched from an SMS. A card marked `all` is shown to everyone. Either card can be paid: the order is recognised by its amount, so the phone must forward the SMS of every card. `TG_PAY_PER_USD` (default 12700) - so'm per 1 USD of the card price.
- **Card transfer (automatic)** - needs `P2P_NOTIFY_KEY` (a long random secret). The player gets a unique, not round amount (price + 1..99 so'm) and must send exactly that. The shop phone forwards every bank SMS to `POST https://<server>/api/p2p/notify?key=<P2P_NOTIFY_KEY>` (JSON `{"text": "<the SMS>"}`, the SMS as a plain body, or whatever shape the forwarder app sends: the text is found in any string field, also nested ones like `{"payload": {"message": ...}}`; Google Play does not allow apps that forward SMS to a URL, so these apps come from GitHub / F-Droid: Incoming SMS to URL Forwarder (bogkonstantin), TextBee, httpSMS, SMS Gateway for Android). An order is paid when its exact amount appears in an SMS. The order lasts 30 minutes.
- **Via ATM (receipt)** - needs `ADMIN_TG_ID` (your Telegram user id: send `/id` to the bot) and that you pressed Start in the bot. The player sends a photo of the receipt, the bot sends it to you with Confirm / Reject buttons. The order lasts 3 days.
- By hand: list the open orders with `curl $SERVER/api/p2p/pending -H "x-admin-key: $ADMIN_KEY"`, then `curl -X POST $SERVER/api/p2p/confirm -H "x-admin-key: $ADMIN_KEY" -d '{"id":"<order id>","ok":true}'`.
- Limits: 3 open orders per player; every payment is counted once (a repeated SMS or button press pays nothing more). Refunds are manual. Check the bank's rules about receiving shop payments on a card, and Telegram's rules for digital goods, before using it.

## Before a large launch
- The server keeps all players in memory and saves changed rows to Postgres every 2 s — fine for tens of thousands of players on one instance.
- Coins earned in matches are currently counted by the player's device. For a competitive economy, make the server the authority for match results and balances.
- Add a Privacy Policy and Terms of Service page (required by the stores and by Stripe).

## Controls
- **Aim:** drag anywhere on the table and the cue turns with your finger. A quick tap aims at the tapped point.
- **Fine aim:** use the ANIQ/FINE wheel, the mouse wheel, or ←/→.
- **Shoot:** pull the power bar down and release, or hold **Space**.
- **Spin:** tap the white ball in the top-right corner.

### Card prices of in-game items (`server/prices.json`)
Every cue / avatar / frame / table / sticker pack that is sold in the game for cash or gems can also be bought with a card. The dollar price comes from
one rule (cash 20 per $, gems 200 per $) and is generated from the game's own catalog: after changing any price or cue tier in `index.html` run
`node tools/build_prices.js` (needs playwright) and commit the new `server/prices.json`. The server charges exactly these amounts (the client price is never trusted).
Cue strength follows price: cash cues sit on 8 dollar steps ($1.99 ... $74.99) and the four stat bars come from the step; coin cues come in 9 steps of 5 cues.

## Hosting layout (current)
- **Game server (API, WebSocket, lobbies, accounts):** Render (`server/`, `render.yaml`), `https://billiard8.onrender.com`. Environment: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_APP_LINK`, `TURN_*`, Stripe keys.
- **Game page (static, light build):** Cloudflare Workers static assets (`wrangler.jsonc`). Cloudflare runs `python3 tools/build_web.py web_site` after every push to the production branch; the page is ~2 MB, the pictures (including the table-rail and cue art) and sounds are separate files under `img/` and `a/` that never change (cached for a year). The game loads the table / cue art in the background after the menu is up (`bgStart()` in `index.html`; a match gets its own table and cue first), and inside Telegram the page calls `ready()` as soon as Telegram's script is there and pings `/api/health` so a sleeping Render server wakes up while the page loads. The Render server only answers API calls, so its free bandwidth lasts.
- **Telegram Mini App:** `@Billiard8PoolBot`, web app URL = the Cloudflare address; players sign in silently with their Telegram account.
- **CrazyGames / Y8:** `python3 tools/build_crazy.py` (single file) and the Y8 zip (see above).
