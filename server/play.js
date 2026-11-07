"use strict";
// Google Play Billing, server side: the Android app buys a 💎 pack (a consumable in-app product whose id is the pack's SKU: gems_100 ... gems_5000) with Google Play,
// sends the purchase token here, and this module asks the Google Play Developer API whether the token is a real, paid purchase of that product.
// After the server has handed the diamonds over it CONSUMES the purchase (so the pack can be bought again; consuming also acknowledges it - an unacknowledged purchase is refunded by Google after 3 days).
// No dependencies: the service account's JWT is signed with Node's crypto.
//   PLAY_SERVICE_ACCOUNT  the service account's JSON key (the text itself, or the same text base64-encoded - easier to paste into an env var). The account must be invited in Play Console (Users and permissions) with "Manage orders and subscriptions".
//   PLAY_PACKAGE          the app's package name (default com.royalbilliard8.app = appId in android/capacitor.config.json)
//   PLAY_API_BASE, PLAY_OAUTH_URL   only for tests: where the fake Google lives
const crypto = require("crypto");

const API_BASE = () => String(process.env.PLAY_API_BASE || "https://androidpublisher.googleapis.com").replace(/\/+$/, "");
const OAUTH_URL = () => process.env.PLAY_OAUTH_URL || "https://oauth2.googleapis.com/token";
const PACKAGE = () => process.env.PLAY_PACKAGE || "com.royalbilliard8.app";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function serviceAccount() {   // {client_email, private_key} or null when the env var is missing / not a service account key
  const raw = String(process.env.PLAY_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  for (const txt of [raw, (() => { try { return Buffer.from(raw, "base64").toString("utf8"); } catch (e) { return ""; } })()]) {
    try { const j = JSON.parse(txt); if (j && typeof j.client_email === "string" && typeof j.private_key === "string" && j.private_key.includes("PRIVATE KEY")) return j; } catch (e) {}
  }
  return null;
}
const configured = () => !!serviceAccount();

const b64u = x => Buffer.from(x).toString("base64url");
function signedJwt(sa, aud, now = Math.floor(Date.now() / 1000)) {   // the service account's proof for the token endpoint (RS256)
  const head = b64u(JSON.stringify({alg: "RS256", typ: "JWT"})), body = b64u(JSON.stringify({iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600}));
  return `${head}.${body}.${crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key, "base64url")}`;
}

let cache = null, inflight = null;   // the OAuth access token is valid for an hour: one for all requests
async function accessToken() {
  if (cache && cache.exp > Date.now() + 60e3) return cache.tok;
  if (inflight) return inflight;
  inflight = (async () => {
    const sa = serviceAccount(); if (!sa) throw Object.assign(new Error("not configured"), {code: "not_configured"});
    const r = await fetch(OAUTH_URL(), {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedJwt(sa, OAUTH_URL())}).toString()});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw Object.assign(new Error(`google oauth ${r.status} ${String(j.error_description || j.error || "").slice(0, 120)}`), {code: "oauth"});
    cache = {tok: j.access_token, exp: Date.now() + Math.max(60, +j.expires_in || 3600) * 1000};
    return cache.tok;
  })().finally(() => { inflight = null; });
  return inflight;
}

async function call(method, productId, token, suffix = "", body = undefined) {   // one Developer API request; resolves {status, json}
  const url = `${API_BASE()}/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE())}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}${suffix}`;
  const r = await fetch(url, {method, headers: {Authorization: "Bearer " + await accessToken(), ...(body !== undefined ? {"Content-Type": "application/json"} : {})}, body, signal: AbortSignal.timeout(15000)});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) cache = null;   // the access token was refused: ask for a new one next time
  return {status: r.status, json: j};
}

// purchases.products.get -> {ok, state: "purchased" | "pending" | "canceled", orderId, account, consumed, acked, test} or {ok: false, error}
async function lookup(productId, token) {
  const {status, json} = await call("GET", productId, token);
  if (status === 200) {
    const st = json.purchaseState === 0 ? "purchased" : json.purchaseState === 2 ? "pending" : "canceled";
    return {ok: true, state: st, orderId: String(json.orderId || ""), account: String(json.obfuscatedExternalAccountId || ""), consumed: json.consumptionState === 1, acked: json.acknowledgementState === 1, test: json.purchaseType === 0, qty: json.quantity | 0 || 1};
  }
  const msg = String(json.error && json.error.message || "").slice(0, 140);
  if (status === 400 || status === 404 || status === 410) return {ok: false, error: "bad_token", status, detail: msg};   // not a purchase of this app / product, or one that was refunded and removed
  if (status === 401 || status === 403) return {ok: false, error: "play_auth", status, detail: msg};   // the service account may not read this app's orders: a setting in Play Console, not the player's fault
  return {ok: false, error: "play_down", status, detail: msg};
}

// purchases.products.consume (consuming also acknowledges); when that fails, acknowledge at least, so Google does not refund the purchase after 3 days. Returns "consumed" | "acked" | ""
async function finish(productId, token) {
  // (consume takes no request body at all)
  try { const c = await call("POST", productId, token, ":consume"); if (c.status === 200 || c.status === 204) return "consumed"; } catch (e) {}
  try { const a = await call("POST", productId, token, ":acknowledge", "{}"); if (a.status === 200 || a.status === 204) return "acked"; } catch (e) {}
  return "";
}

// the id the app gives Google with the purchase (BillingFlowParams.setObfuscatedAccountId): a one-way hash of the player's id, so a purchase token cannot be handed over to another player's account
const accountTag = userId => crypto.createHash("sha256").update("rb8-play:" + String(userId)).digest("hex").slice(0, 32);

module.exports = {configured, lookup, finish, accountTag, signedJwt, serviceAccount, PACKAGE};
