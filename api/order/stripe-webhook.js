/* POST /api/order/stripe-webhook — Stripe → us. Register in Stripe Dashboard →
   Developers → Webhooks: https://www.kawtar.ca/api/order/stripe-webhook
   Event: checkout.session.completed. Set STRIPE_WEBHOOK_SECRET (whsec_…). */
const { stripe } = require('../_lib/stripe');
const { updateOrder, getOrder, orderNo } = require('../_lib/orders');
const { notify } = require('../_lib/notify');

module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (req.body != null) {
      if (Buffer.isBuffer(req.body)) return resolve(req.body);
      if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
      return resolve(Buffer.from(JSON.stringify(req.body)));
    }
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  let event;
  try {
    const raw = await readRaw(req);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET unset');
    event = stripe().webhooks.constructEvent(raw, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.error('stripe webhook: bad signature —', e.message);
    return res.status(400).json({ error: 'bad_signature' });
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      if (s.payment_status !== 'paid' || !s.payment_intent) return res.status(200).json({ ignored: true });
      const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent.id;
      const existing = await getOrder(piId);
      if (existing && existing.status !== 'pending_payment') return res.status(200).json({ ok: true, duplicate: true });
      const order = await updateOrder(piId, {
        order_status: 'new', order_no: orderNo(piId), session_id: s.id, paid_at: new Date().toISOString(),
      });
      await notify.newOrder(order);
      console.log('order paid:', order.order_no, order.mode, order.amount_cents);
    }
    if (event.type === 'checkout.session.expired') {
      console.log('checkout expired:', event.data.object.id);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('stripe webhook failed:', e.message);
    return res.status(500).json({ error: 'handler_failed' });   // Stripe will retry
  }
};
