"use strict";
// The rules of shashka and Magic Chess for the SERVER (stake matches: the server, not a phone, decides how a match ends).
// There is ONE copy of the rules: the pure blocks /*SH_CORE_BEGIN*/ .. /*SH_CORE_END*/ and /*MC_CORE_BEGIN*/ .. /*MC_CORE_END*/ of index.html (the phones and the tests use the same text). They are copied into
// server/boardcores.js by tools/build_cores.js (run it after changing those blocks; server/test_boardcores.js fails when the file is out of date), so the server never has to read index.html (50 MB: it held
// ~100 MB of RAM for as long as it ran). If the file cannot be loaded, `ok` is false and the server does not open stake rooms for shashka / chess.
function load() {
  const out = {ok: false, why: ""};
  try { Object.assign(out, require("./boardcores.js")(), {ok: true}); } catch (e) { out.why = String(e && e.message || e).slice(0, 120); }
  return out;
}
module.exports = {load};
