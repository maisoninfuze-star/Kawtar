/* POST /api/delivery/webhook — Uber Direct pushes status changes here.
   Register this URL in the Uber Direct dashboard → Developer → Webhooks:
     https://www.kawtar.ca/api/delivery/webhook
   Events: event.delivery_status (pending → pickup → pickup_complete → dropoff →
   delivered | canceled | returned) and event.courier_update (live location).

   Signature: Uber sends X-Postmates-Signature = HMAC-SHA256(raw body, signing key).
   Set UBER_DIRECT_WEBHOOK_SECRET to enforce it. Unset → accepted with a warning
   (fine for sandbox, NOT for production). */
const crypto = require('crypto');

module.exports.config = { api: { bodyParser: false } };   // we need the raw bytes for the HMAC

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (req.body != null) {                                   // platform already parsed it
      if (Buffer.isBuffer(req.body)) return resolve(req.body);
      if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
      return resolve(Buffer.from(JSON.stringify(req.body)));  // best effort
    }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  try {
    const raw = await readRaw(req);
    const secret = process.env.UBER_DIRECT_WEBHOOK_SECRET;
    const sig = req.headers['x-postmates-signature'] || '';
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      const ok = sig.length === expected.length &&
                 crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) { console.warn('uber webhook: bad signature'); return res.status(401).json({ error: 'bad_signature' }); }
    } else {
      console.warn('uber webhook: UBER_DIRECT_WEBHOOK_SECRET unset — signature NOT verified');
    }

    const ev = JSON.parse(raw.toString('utf8') || '{}');
    const kind = ev.kind || ev.event_type || 'unknown';
    const d = ev.data || ev.delivery || ev;
    const summary = {
      kind, delivery_id: d.id || ev.delivery_id, external_id: d.external_id,
      status: d.status || ev.status, courier: d.courier && d.courier.name,
      dropoff_eta: d.dropoff_eta, at: new Date().toISOString(),
    };
    console.log('uber webhook:', JSON.stringify(summary));

    // ---- update the order + tell the customer ----
    if (kind !== 'event.courier_update' && (summary.delivery_id || summary.external_id)) {
      try {
        const { findByUberDelivery, updateOrder } = require('../_lib/orders');
        const { notify } = require('../_lib/notify');
        const o = await findByUberDelivery(summary.delivery_id, summary.external_id);
        if (o) {
          const st = String(summary.status || '');
          const patch = { uber_status: st };
          if (d.tracking_url) patch.uber_tracking_url = d.tracking_url;
          if (d.courier && d.courier.name) patch.uber_courier = d.courier.name;
          if (st === 'pickup_complete' || st === 'dropoff') {
            if (o.status !== 'dispatched' && o.status !== 'delivered') patch.order_status = 'dispatched';
          } else if (st === 'delivered') {
            patch.order_status = 'delivered'; patch.completed_at = new Date().toISOString();
          } else if (st === 'canceled' || st === 'returned') {
            patch.uber_status = st;
          }
          const upd = await updateOrder(o.id, patch);
          if (patch.order_status === 'dispatched' && o.status !== 'dispatched') await notify.dispatched(upd);
          if (patch.order_status === 'delivered' && o.status !== 'delivered') await notify.delivered(upd);
          if (st === 'canceled' || st === 'returned') await notify.uberProblem(upd, 'Courier ' + st);
        } else {
          console.warn('uber webhook: no order for delivery', summary.delivery_id);
        }
      } catch (e) { console.error('uber webhook: order update failed', e.message); }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('uber webhook failed:', err.message);
    return res.status(400).json({ error: 'bad_payload' });
  }
};
