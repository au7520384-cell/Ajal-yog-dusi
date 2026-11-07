"use strict";
// A fake Google for the tests of Google Play Billing (server/test_play.js, tools/test_play_ui.js): the OAuth token endpoint (it really verifies the service account's RS256 JWT)
// and the Google Play Developer API purchases.products get / consume / acknowledge. Orders are made in memory with order().
const http = require("http"), crypto = require("crypto");
const EMAIL = "billing@royal-test.iam.gserviceaccount.com", PKG = "com.royalbilliard8.app";
module.exports = async function startFakePlay(port) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const saJson = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "http://example.invalid/never-used" });
  const orders = new Map(), st = { oauth: 0, jwtOk: 0, get: 0, consume: 0, ack: 0 }, opts = { failConsume: false, getStatus: 200 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString(), u = new URL(req.url, "http://x");
    const send = (s, j) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.method === "POST" && u.pathname === "/token") {
      st.oauth++; const p = new URLSearchParams(body);
      if (p.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return send(400, { error: "unsupported_grant_type" });
      const [h, c, s] = String(p.get("assertion")).split("."); let good = false;
      try {
        const head = JSON.parse(Buffer.from(h, "base64url")), cl = JSON.parse(Buffer.from(c, "base64url"));
        good = crypto.createVerify("RSA-SHA256").update(h + "." + c).verify(publicKey, s, "base64url") && head.alg === "RS256" && cl.iss === EMAIL && cl.scope === "https://www.googleapis.com/auth/androidpublisher" && cl.aud === `http://localhost:${port}/token` && cl.exp > Date.now() / 1000 && cl.exp - cl.iat <= 3600;
      } catch (e) {}
      if (!good) return send(400, { error: "invalid_grant", error_description: "Invalid JWT" });
      st.jwtOk++; return send(200, { access_token: "tok-" + st.oauth, expires_in: 3600, token_type: "Bearer" });
    }
    const m = u.pathname.match(/^\/androidpublisher\/v3\/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:consume|:acknowledge)?$/);
    if (!m) return send(404, { error: { code: 404, message: "no route" } });
    if (!/^Bearer tok-\d+$/.test(req.headers.authorization || "")) return send(401, { error: { code: 401, message: "Request is missing required authentication credential." } });
    if (opts.getStatus !== 200) return send(opts.getStatus, { error: { code: opts.getStatus, message: "forced " + opts.getStatus } });
    const [, pkg, pid, token0, act] = m, token = decodeURIComponent(token0), o = orders.get(token);
    if (pkg !== PKG) return send(404, { error: { code: 404, message: "Package not found" } });
    if (!o || o.productId !== decodeURIComponent(pid)) return send(400, { error: { code: 400, message: "The purchase token does not match the product." } });
    if (!act) { st.get++; return send(200, { kind: "androidpublisher#productPurchase", purchaseTimeMillis: "1", purchaseState: o.state, consumptionState: o.consumed ? 1 : 0, acknowledgementState: o.acked ? 1 : 0, orderId: o.orderId, purchaseType: o.test ? 0 : undefined, quantity: 1, productId: o.productId, ...(o.account ? { obfuscatedExternalAccountId: o.account } : {}) }); }
    if (act === ":consume") { st.consume++; if (opts.failConsume) return send(500, { error: { code: 500, message: "consume failed" } }); o.consumed = true; o.acked = true; return send(200, {}); }
    st.ack++; o.acked = true; return send(200, {});
  });
  await new Promise(r => server.listen(port, r));
  const order = (token, productId, o = {}) => { const rec = { productId, state: 0, consumed: false, acked: false, orderId: "GPA." + token.slice(0, 4), account: "", ...o }; orders.set(token, rec); return rec; };
  return { saJson, orders, st, opts, order, EMAIL, PKG, port, close: () => server.close() };
};
module.exports.EMAIL = EMAIL; module.exports.PKG = PKG;
