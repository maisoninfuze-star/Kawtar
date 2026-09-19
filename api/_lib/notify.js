/* Notifications — two independent channels, each optional, neither can break an order:
   1. E-mail we send ourselves (api/_lib/email.js): customer confirmation / ready /
      en-route with the Uber tracking link / cancelled+refund, and restaurant alerts.
      Needs SMTP_* (+ ORDER_EMAIL_TO for the restaurant copy).
   2. GoHighLevel inbound webhook (GHL_ORDER_WEBHOOK): every event is POSTed with
      `event` + `audience` so a GHL workflow can add SMS on top.                  */
const { CFG, MENU } = require('./menu');
const { sendCustomerEmail, sendRestaurantEmail } = require('./email');

const money = c => (c / 100).toFixed(2).replace('.', ',') + ' $';

function describe(o) {
  const items = (o.cart_lines || []).map(l => `${l.qty}× ${l.fr}`).join(', ') || o.cart;
  return {
    order_no: o.order_no, order_id: o.id, status: o.status, mode: o.mode,
    mode_fr: o.mode === 'delivery' ? 'Livraison' : 'Ramassage',
    customer_name: o.customer.name, phone: o.customer.phone, email: o.customer.email || '',
    items, items_count: (o.cart_lines || []).reduce((s, l) => s + l.qty, 0),
    subtotal: money(o.subtotal_cents), delivery_fee: money(o.delivery_fee_cents),
    tip: money(o.tip_cents), taxes: money(o.tax_cents), total: money(o.amount_cents),
    notes: o.notes || '', dropoff_notes: o.dropoff_notes || '',
    address: o.address ? [o.address.street, o.address.city, o.address.postal].filter(Boolean).join(', ') : '',
    prep_minutes: o.prep_minutes || '', ready_at: o.ready_at || '',
    tracking_url: (o.uber && o.uber.tracking_url) || '',
    kitchen_url: `${MENU.restaurant.site}/cuisine.html`,
    lang: o.lang, restaurant_phone: MENU.restaurant.phone,
  };
}

async function ghl(event, audience, order, extra = {}) {
  const url = process.env.GHL_ORDER_WEBHOOK;
  if (!url) { console.warn('notify: GHL_ORDER_WEBHOOK unset — skipped', event); return false; }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, audience, source: 'kawtar.ca — commandes', at: new Date().toISOString(), ...describe(order), ...extra }) });
    if (!r.ok) console.error('notify: GHL HTTP', r.status, event);
    return r.ok;
  } catch (e) { console.error('notify: GHL failed', e.message); return false; }
}

/* Event helpers — fan out to every channel; a failed channel only logs. */
const all = (...ps) => Promise.allSettled(ps).then(r => r.forEach(x => { if (x.status === 'rejected') console.error('notify:', x.reason && x.reason.message); }));
const notify = {
  newOrder:   (o) => all(sendCustomerEmail(o, 'order_paid'), sendRestaurantEmail(o, 'order_paid'), ghl('order_paid', 'kitchen', o), ghl('order_paid', 'customer', o)),
  accepted:   (o) => all(sendCustomerEmail(o, 'order_accepted'), ghl('order_accepted', 'customer', o)),
  ready:      (o) => all(sendCustomerEmail(o, 'order_ready'), ghl('order_ready', 'customer', o)),
  dispatched: (o) => all(sendCustomerEmail(o, 'order_dispatched'), ghl('order_dispatched', 'customer', o)),
  delivered:  (o) => all(ghl('order_delivered', 'customer', o)),
  cancelled:  (o, reason) => all(sendCustomerEmail(o, 'order_cancelled', { reason }), sendRestaurantEmail(o, 'order_cancelled', { reason }),
                                 ghl('order_cancelled', 'customer', o, { reason }), ghl('order_cancelled', 'kitchen', o, { reason })),
  uberProblem:(o, detail) => all(sendRestaurantEmail(o, 'delivery_problem', { detail }), ghl('delivery_problem', 'kitchen', o, { detail })),
};
module.exports = { notify, describe, money };
