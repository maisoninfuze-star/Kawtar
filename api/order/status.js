/* GET /api/order/status?s=<checkout_session_id>  — public, for the thank-you page.
   Returns only what the customer needs; keyed by the unguessable session id. */
const { stripe } = require('../_lib/stripe');
const { fromPI } = require('../_lib/orders');
module.exports = async (req, res) => {
  try {
    const sid = (req.query && req.query.s) || new URL(req.url, 'http://x').searchParams.get('s');
    if (!sid || !/^cs_/.test(sid)) return res.status(400).json({ error: 'bad_session' });
    const s = await stripe().checkout.sessions.retrieve(sid, { expand: ['payment_intent'] });
    if (!s.payment_intent || typeof s.payment_intent === 'string') return res.status(200).json({ status: 'pending_payment' });
    const o = fromPI(s.payment_intent);
    if (!o) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      order_no: o.order_no, status: o.status, mode: o.mode, lang: o.lang,
      customer_name: o.customer.name, amount_cents: o.amount_cents,
      cart_lines: o.cart_lines, subtotal_cents: o.subtotal_cents, delivery_fee_cents: o.delivery_fee_cents,
      tip_cents: o.tip_cents, tax_cents: o.tax_cents,
      prep_minutes: o.prep_minutes, ready_at: o.ready_at,
      tracking_url: o.uber && o.uber.tracking_url || null, uber_status: o.uber && o.uber.status || null,
      address: o.address, paid: o.paid,
    });
  } catch (e) { return res.status(e.status || 500).json({ error: e.code || 'error', message: e.message }); }
};
