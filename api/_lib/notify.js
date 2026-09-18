/* Notifications. One GHL inbound webhook receives every order event with an
   `event` + `audience` field; a GHL workflow branches on them (SMS owner,
   SMS/email customer). Optional SMTP email to the restaurant as a second channel.
     GHL_ORDER_WEBHOOK   GoHighLevel workflow inbound-webhook URL
     ORDER_EMAIL_TO      (optional) restaurant inbox — uses the SMTP_* vars       */
const { CFG, MENU } = require('./menu');

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

async function emailRestaurant(order) {
  const to = process.env.ORDER_EMAIL_TO;
  const ok = to && ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].every(k => process.env[k]);
  if (!ok) return false;
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT,
      secure: +process.env.SMTP_PORT === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    const d = describe(order);
    const rows = (order.cart_lines || []).map(l => `${l.qty}× ${l.fr}${l.note ? ' — ' + l.note : ''}`).join('\n');
    await t.sendMail({
      from: `"Commandes — kawtar.ca" <${process.env.SMTP_USER}>`, to,
      subject: `Commande ${d.order_no} · ${d.mode_fr} · ${d.total}`,
      text: `${d.mode_fr.toUpperCase()} — ${d.order_no}\n${d.customer_name} · ${d.phone}\n${d.address}\n\n${rows}\n\nSous-total ${d.subtotal} · Livraison ${d.delivery_fee} · Pourboire ${d.tip} · Taxes ${d.taxes}\nTOTAL ${d.total}\n\nNotes: ${d.notes}\n\nÉcran cuisine : ${d.kitchen_url}`,
    });
    return true;
  } catch (e) { console.error('notify: email failed', e.message); return false; }
}

/* Event helpers */
const notify = {
  newOrder:   (o) => Promise.all([ghl('order_paid', 'kitchen', o), ghl('order_paid', 'customer', o), emailRestaurant(o)]),
  accepted:   (o) => ghl('order_accepted', 'customer', o),
  ready:      (o) => ghl('order_ready', 'customer', o),
  dispatched: (o) => ghl('order_dispatched', 'customer', o),
  delivered:  (o) => ghl('order_delivered', 'customer', o),
  cancelled:  (o, reason) => Promise.all([ghl('order_cancelled', 'customer', o, { reason }), ghl('order_cancelled', 'kitchen', o, { reason })]),
  uberProblem:(o, detail) => ghl('delivery_problem', 'kitchen', o, { detail }),
};
module.exports = { notify, describe, money };
