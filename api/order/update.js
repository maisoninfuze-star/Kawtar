/* POST /api/order/update  (X-Kitchen-Pin)
   { id, action: 'accept'|'ready'|'complete'|'cancel', prep_minutes?, reason? }
   accept  → status accepted, ready_at = now+prep; DELIVERY: books the Uber courier
             timed to arrive when the food is ready (pickup_ready_dt)
   ready   → status ready (pickup: customer told to come; delivery: courier en route/arriving)
   complete→ handed to customer (pickup) — closes the order
   cancel  → full Stripe refund + notify customer */
const { requirePin } = require('../_lib/kitchen-auth');
const { stripe } = require('../_lib/stripe');
const { getOrder, updateOrder } = require('../_lib/orders');
const { notify } = require('../_lib/notify');
const { PICKUP, uber, addressString, isoInMinutes } = require('../_lib/uber');
const { CFG } = require('../_lib/menu');

const QUOTE_FRESH_MS = 12 * 60_000;   // Uber quotes expire after 15 min; don't send one that is about to

async function bookCourier(o, prep) {
  const a = o.address || {};
  const items = (o.cart_lines || []).map(l => ({ name: l.fr.slice(0, 100), quantity: l.qty, size: 'small' }));
  const body = {
    pickup_name: PICKUP.name, pickup_address: addressString(PICKUP.address),
    pickup_phone_number: PICKUP.phone, pickup_notes: `${PICKUP.notes} Commande ${o.order_no}.`,
    pickup_business_name: PICKUP.name,
    dropoff_name: o.customer.name, dropoff_phone_number: o.customer.phone,
    dropoff_address: addressString({ street_address: [a.street], city: a.city, zip_code: a.postal, state: 'QC', country: 'CA' }),
    ...(o.dropoff_notes ? { dropoff_notes: o.dropoff_notes } : {}),
    manifest_items: items.length ? items : [{ name: 'Commande Kawtar', quantity: 1, size: 'small' }],
    external_id: o.id,
    pickup_ready_dt: isoInMinutes(prep),
    ...(o.tip_cents ? { tip: o.tip_cents } : {}),
    deliverable_action: 'deliverable_action_meet_at_door', undeliverable_action: 'return',
    // Sandbox only: UBER_DIRECT_ROBOCOURIER=auto makes Uber's robo-courier walk the delivery
    // through pickup → delivered (~2.5 min) and fire real webhooks. Remove the var for production.
    ...(process.env.UBER_DIRECT_ROBOCOURIER ? { test_specifications: { robo_courier_specification: { mode: process.env.UBER_DIRECT_ROBOCOURIER } } } : {}),
  };
  // Reuse the checkout quote while it is fresh (locks the price); otherwise Uber re-quotes at creation.
  const fresh = o.uber_quote && o.uber_quote.id && Date.now() - o.created < QUOTE_FRESH_MS;
  if (!fresh) return uber('/deliveries', { method: 'POST', body });
  try {
    return await uber('/deliveries', { method: 'POST', body: { quote_id: o.uber_quote.id, ...body } });
  } catch (e) {
    if (e.status !== 400 || !/quote/i.test(String(e.code) + String(e.message))) throw e;
    console.warn('uber: quote rejected (' + e.code + '), re-booking without quote_id');
    return uber('/deliveries', { method: 'POST', body });
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (!requirePin(req, res)) return;
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const o = await getOrder(String(b.id || ''));
    if (!o) return res.status(404).json({ error: 'not_found' });
    const now = new Date().toISOString();
    let out;

    switch (b.action) {
      case 'accept': {
        if (o.status !== 'new') return res.status(409).json({ error: 'bad_state', status: o.status });
        const prep = Math.min(120, Math.max(5, parseInt(b.prep_minutes, 10) || CFG.prep_minutes_default));
        const patch = { order_status: 'accepted', prep_minutes: prep, accepted_at: now, ready_at: isoInMinutes(prep) };
        if (o.mode === 'delivery') {
          try {
            const d = await bookCourier(o, prep);
            Object.assign(patch, { uber_delivery_id: d.id, uber_tracking_url: d.tracking_url, uber_status: d.status,
                                   uber_fee_cents: d.fee != null ? d.fee : ((o.uber_quote && o.uber_quote.fee_cents) || '') });
          } catch (e) {
            console.error('uber booking failed:', e.message, e.detail || '');
            out = await updateOrder(o.id, { ...patch, uber_status: 'booking_failed' });
            await notify.uberProblem(out, e.message);
            return res.status(502).json({ error: 'uber_booking_failed', message: e.message, order: out });
          }
        }
        out = await updateOrder(o.id, patch);
        await notify.accepted(out);
        break;
      }
      case 'ready': {
        if (!['accepted', 'new'].includes(o.status)) return res.status(409).json({ error: 'bad_state', status: o.status });
        out = await updateOrder(o.id, { order_status: 'ready', ready_at: now });
        await notify.ready(out);
        break;
      }
      case 'complete': {
        out = await updateOrder(o.id, { order_status: 'completed', completed_at: now });
        break;
      }
      case 'cancel': {
        if (['completed', 'cancelled'].includes(o.status)) return res.status(409).json({ error: 'bad_state', status: o.status });
        if (o.uber && o.uber.id && !['pickup_complete', 'dropoff', 'delivered'].includes(o.uber.status || '')) {
          try { await uber(`/deliveries/${o.uber.id}/cancel`, { method: 'POST' }); } catch (e) { console.warn('uber cancel:', e.message); }
        }
        await stripe().refunds.create({ payment_intent: o.id, reason: 'requested_by_customer',
          metadata: { kawtar: 'refund', order_no: o.order_no, why: String(b.reason || '').slice(0, 200) } });
        out = await updateOrder(o.id, { order_status: 'cancelled', cancelled_at: now, cancel_reason: String(b.reason || '').slice(0, 200) });
        await notify.cancelled(out, b.reason || '');
        break;
      }
      default: return res.status(400).json({ error: 'bad_action' });
    }
    return res.status(200).json({ ok: true, order: out });
  } catch (e) {
    console.error('update failed:', e.message, e.detail || '');
    return res.status(e.status || 500).json({ error: e.code || 'error', message: e.message });
  }
};

module.exports.bookCourier = bookCourier;   // exposed for scripts/uber-sandbox-test.js
