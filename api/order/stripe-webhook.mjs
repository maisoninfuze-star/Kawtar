/* POST /api/order/stripe-webhook — Stripe → us.
   Web-standard handler (Request → Response) on purpose: Vercel's Node helpers
   pre-parse JSON bodies, and Stripe's signature only verifies against the exact
   raw bytes it sent. request.text() gives us those bytes untouched.
   Register in Stripe → Workbench → Webhooks: https://www.kawtar.ca/api/order/stripe-webhook
   Events: checkout.session.completed (+ async_payment_succeeded, expired). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { stripe } = require('../_lib/stripe.js');
const { updateOrder, getOrder, orderNo } = require('../_lib/orders.js');
const { notify } = require('../_lib/notify.js');

const json = (obj, status = 200) => Response.json(obj, { status });

export async function POST(request) {
  let event;
  try {
    const raw = await request.text();                       // exact bytes Stripe signed
    const sig = request.headers.get('stripe-signature') || '';
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) { console.error('stripe webhook: STRIPE_WEBHOOK_SECRET unset'); return json({ error: 'not_configured' }, 500); }
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error('stripe webhook: bad signature —', e.message);
    return json({ error: 'bad_signature' }, 400);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      if (s.payment_status !== 'paid' || !s.payment_intent) return json({ ignored: true });
      const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent.id;
      const existing = await getOrder(piId);
      if (existing && existing.status !== 'pending_payment') return json({ ok: true, duplicate: true });
      const order = await updateOrder(piId, {
        order_status: 'new', order_no: orderNo(piId), session_id: s.id, paid_at: new Date().toISOString(),
      });
      await notify.newOrder(order);
      console.log('order paid:', order.order_no, order.mode, order.amount_cents);
    } else if (event.type === 'checkout.session.expired') {
      console.log('checkout expired:', event.data.object.id);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('stripe webhook failed:', e.message);
    return json({ error: 'handler_failed' }, 500);          // Stripe retries 5xx
  }
}

export function GET() { return json({ error: 'method_not_allowed' }, 405); }
