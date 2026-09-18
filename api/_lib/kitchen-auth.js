/* Kitchen endpoints are protected by a PIN sent as X-Kitchen-Pin (over HTTPS).
   Set KITCHEN_PIN in env. */
const crypto = require('crypto');
function authed(req) {
  const pin = process.env.KITCHEN_PIN;
  const got = String(req.headers['x-kitchen-pin'] || '');
  if (!pin || !got || got.length !== pin.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(pin));
}
function requirePin(req, res) {
  if (!process.env.KITCHEN_PIN) { res.status(500).json({ error: 'not_configured', message: 'KITCHEN_PIN unset' }); return false; }
  if (!authed(req)) { res.status(401).json({ error: 'unauthorized' }); return false; }
  return true;
}
module.exports = { requirePin };
