"use strict";
// The rules of shashka and Magic Chess for the SERVER (stake matches: the server, not a phone, decides how a match ends).
// There is ONE copy of the rules: the pure blocks between /*SH_CORE_BEGIN*/ .. /*SH_CORE_END*/ and /*MC_CORE_BEGIN*/ .. /*MC_CORE_END*/ in index.html (the phones and the tests use the same text).
// They are cut out of index.html when the server starts. If the blocks cannot be found (an index.html that is not the game's), `ok` is false and the server does not open stake rooms.
const fs = require("fs"), path = require("path");
function load(file) {
  const out = {ok: false, why: ""};
  try {
    const src = fs.readFileSync(file || path.join(__dirname, "..", "index.html"), "utf8");
    const cut = n => { const a = src.indexOf(`/*${n}_CORE_BEGIN*/`), b = src.indexOf(`/*${n}_CORE_END*/`); if (a < 0 || b < a) throw new Error(n + " core not found"); return src.slice(a, b); };
    const f = new Function(cut("SH") + "\n" + cut("MC") + "\nreturn {shNew, shFind, shPlay, shGen, shApply, mcNew, mcFind, mcPlay, mcLegal, mcPath};");
    Object.assign(out, f(), {ok: true});
  } catch (e) { out.why = String(e && e.message || e).slice(0, 120); }
  return out;
}
module.exports = {load};
