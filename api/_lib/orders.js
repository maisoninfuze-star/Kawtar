/* Order store = Stripe PaymentIntents + metadata (system of record for now).
   Every paid Checkout Session has a PaymentIntent; we stamp the order there.
   Statuses: new → accepted → ready → (dispatched → delivered) | completed | cancelled */
const { stripe } = require('./stripe');

const STATUSES = ['new', 'accepted', 'ready', 'dispatched', 'delivered', 'completed', 'cancelled'];
const OPEN = ['new', 'accepted', 'ready', 'dispatched'];

/* compact cart for metadata (≤500 chars): "2x tajine-poulet|1x the-marocain:grand" */
function packCart(lines) {
  let s = lines.map(l => `${l.qty}x ${l.id}${l.variant ? ':' + l.variant : ''}`).join('|');
  return s.length > 480 ? s.slice(0, 477) + '…' : s;
}

function orderNo(piId) {
  return 'K-' + piId.slice(-4).toUpperCase();
}

function fromPI(pi) {
  const m = pi.metadata || {};
  if (m.kawtar !== 'order') return null;
  return {
    id: pi.id, order_no: m.order_no || orderNo(pi.id),
    status: m.order_status || 'pending_payment',
    paid: pi.status === 'succeeded', amount_cents: pi.amount, currency: pi.currency,
    created: pi.created * 1000,
    mode: m.mode, lang: m.lang || 'fr',
    customer: { name: m.customer_name, phone: m.phone, email: m.email },
    address: m.address_json ? safeJson(m.address_json) : null,
    dropoff_notes: m.dropoff_notes || '', notes: m.notes || '',
    cart: m.cart || '', cart_lines: m.cart_lines ? safeJson(m.cart_lines) : null,
    subtotal_cents: +m.subtotal_cents || 0, delivery_fee_cents: +m.delivery_fee_cents || 0,
    tip_cents: +m.tip_cents || 0, tax_cents: +m.tax_cents || 0,
    prep_minutes: m.prep_minutes ? +m.prep_minutes : null,
    ready_at: m.ready_at || null,
    uber: m.uber_delivery_id ? { id: m.uber_delivery_id, tracking_url: m.uber_tracking_url, status: m.uber_status,
                                 quote_id: m.uber_quote_id, fee_cents: +m.uber_fee_cents || 0 } : null,
    session_id: m.session_id || null,
    timeline: { paid_at: m.paid_at, accepted_at: m.accepted_at, ready_at: m.ready_at, completed_at: m.completed_at, cancelled_at: m.cancelled_at },
  };
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

/* Realtime list (Stripe list has no indexing lag, unlike Search). */
async function listOrders({ sinceHours = 24, statuses = null, limit = 100 } = {}) {
  const s = stripe();
  const created = { gte: Math.floor(Date.now() / 1000) - sinceHours * 3600 };
  const out = [];
  for await (const pi of s.paymentIntents.list({ created, limit: 100 })) {
    const o = fromPI(pi);
    if (!o || !o.paid) continue;
    if (statuses && !statuses.includes(o.status)) continue;
    out.push(o);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.created - a.created);
}

async function getOrder(piId) {
  const pi = await stripe().paymentIntents.retrieve(piId);
  return fromPI(pi);
}

async function updateOrder(piId, patch) {
  const metadata = {};
  for (const [k, v] of Object.entries(patch)) metadata[k] = v == null ? '' : String(v).slice(0, 500);
  const pi = await stripe().paymentIntents.update(piId, { metadata });
  return fromPI(pi);
}

/* Find the order that owns an Uber delivery (webhook correlation via external_id = pi id). */
async function findByUberDelivery(deliveryId, externalId) {
  if (externalId && externalId.startsWith('pi_')) {
    try { return await getOrder(externalId); } catch { /* fall through */ }
  }
  const recent = await listOrders({ sinceHours: 48 });
  return recent.find(o => o.uber && o.uber.id === deliveryId) || null;
}

module.exports = { STATUSES, OPEN, packCart, orderNo, fromPI, listOrders, getOrder, updateOrder, findByUberDelivery };
