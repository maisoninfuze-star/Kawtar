/* POST /api/delivery/webhook — Uber Direct pushes status changes here.
   Register this URL in the Uber Direct dashboard → Developer → Webhooks:
     https://www.kawtar.ca/api/delivery/webhook
   Events: event.delivery_status (pending → pickup → pickup_complete → dropoff →
   delivered | canceled | returned) and event.courier_update (live location).

   Signature: Uber sends X-Uber-Signature (or X-Postmates-Signature) = HMAC-SHA256 hex(raw body, signing key)
   — the signing key is shown in the Uber Direct dashboard → Developer → Webhooks → ⋯ → Edit.
   Set UBER_DIRECT_WEBHOOK_SECRET to enforce it. Unset → accepted with a warning
   (fine for sandbox, NOT for production).

   Web-standard handler (not the Node (req,res) style) on purpose: Vercel pre-parses
   JSON bodies for (req,res) functions and the re-serialised bytes never match the
   signed ones — request.text() gives us the exact bytes Uber signed. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const json = (obj, status = 200) => Response.json(obj, { status });

export async function POST(request) {
  let raw;
  try {
    raw = await request.text();
    const { envLoose } = require('../_lib/uber.js');
    const secret = envLoose('UBER_DIRECT_WEBHOOK_SECRET');
    // Uber signs with either header name (newer: x-uber-signature; legacy: x-postmates-signature)
    const sig = request.headers.get('x-uber-signature') || request.headers.get('x-postmates-signature') || '';
    if (secret) {
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) { console.warn('uber webhook: bad signature'); return json({ error: 'bad_signature' }, 401); }
    } else {
      console.warn('uber webhook: UBER_DIRECT_WEBHOOK_SECRET unset — signature NOT verified');
    }
  } catch (e) {
    console.error('uber webhook: unreadable body', e.message);
    return json({ error: 'bad_payload' }, 400);
  }

  let ev;
  try { ev = JSON.parse(raw || '{}'); } catch { return json({ error: 'bad_payload' }, 400); }

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
      const { findByUberDelivery, updateOrder } = require('../_lib/orders.js');
      const { notify } = require('../_lib/notify.js');
      const o = await findByUberDelivery(summary.delivery_id, summary.external_id);
      if (o) {
        const st = String(summary.status || '');
        const patch = { uber_status: st };
        if (d.tracking_url) patch.uber_tracking_url = d.tracking_url;
        if (d.dropoff_eta) patch.uber_eta = d.dropoff_eta;
        if (d.courier && d.courier.name) patch.uber_courier = d.courier.name;
        if (st === 'pickup_complete' || st === 'dropoff') {
          if (o.status !== 'dispatched' && o.status !== 'delivered') patch.order_status = 'dispatched';
        } else if (st === 'delivered') {
          patch.order_status = 'delivered'; patch.completed_at = new Date().toISOString();
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

  return json({ ok: true });
}

export function GET() { return json({ error: 'method_not_allowed' }, 405); }
