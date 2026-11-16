// TEST ONLY: node -r ./tools/fake_clock.js server/server.js   (CLOCK_FILE = a file holding the shift in milliseconds; it is read at every call, so a test can jump the server's clock)
// Date.now() and new Date() (no arguments) return the real time + the shift; timers (setInterval) keep running in real time.
const fs = require("fs"), RealDate = Date, file = process.env.CLOCK_FILE;
const shift = () => { try { return +fs.readFileSync(file, "utf8") || 0; } catch (e) { return 0; } };
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shift()); }
  static now() { return RealDate.now() + shift(); }
}
global.Date = FakeDate;
