/* Stripe client (lazy) — STRIPE_SECRET_KEY from env. Test keys start with sk_test_. */
let client = null;
function stripe() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('missing env STRIPE_SECRET_KEY'), { status: 500, code: 'not_configured' });
  client = require('stripe')(key, { apiVersion: '2025-08-27.basil', appInfo: { name: 'kawtar-ordering', version: '1.0.0' } });
  return client;
}
module.exports = { stripe };
