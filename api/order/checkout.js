/* POST /api/order/checkout
   Body: { cart:[{id,qty,variant?,note?}], mode:'pickup'|'delivery', customer:{name,phone,email},
           address?:{street,city,postal,notes?}, tip_cents?, notes?, lang? }
   → { url }  (Stripe Checkout hosted page)
   All prices are recomputed server-side. For delivery, Uber is quoted first so we
   know the address is serviceable and what it will cost us, before taking payment. */
const { stripe } = require('../_lib/stripe');
const { MENU, CFG, priceCart, customerDeliveryFee, taxes, err } = require('../_lib/menu');
const { packCart } = require('../_lib/orders');
const { PICKUP, uber, addressString, phone: e164 } = require('../_lib/uber');

const SITE = process.env.SITE_URL || MENU.restaurant.site;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const mode = b.mode === 'delivery' ? 'delivery' : 'pickup';
    const lang = b.lang === 'en' ? 'en' : 'fr';
    const c = b.customer || {};
    if (!c.name || !e164(c.phone)) throw err(400, 'missing_customer');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(c.email || ''))) throw err(400, 'bad_email');
    if (mode === 'delivery' && !CFG.delivery) throw err(400, 'delivery_disabled');
    if (mode === 'pickup' && !CFG.pickup) throw err(400, 'pickup_disabled');

    const { lines, subtotal_cents } = priceCart(b.cart);

    // ---- delivery: quote Uber now (serviceability + our real cost) ----
    let delivery_fee_cents = 0, uberQuote = null, address = null;
    if (mode === 'delivery') {
      const a = b.address || {};
      if (!a.street || !a.city || !a.postal) throw err(400, 'missing_address');
      address = { street: String(a.street).slice(0, 120), city: String(a.city).slice(0, 60),
                  postal: String(a.postal).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 10), notes: String(a.notes || '').slice(0, 200) };
      const q = await uber('/delivery_quotes', { method: 'POST', body: {
        pickup_address: addressString(PICKUP.address),
        dropoff_address: addressString({ street_address: [address.street], city: address.city, zip_code: address.postal, state: 'QC', country: 'CA' }),
      }}).catch(e => { throw err(400, 'address_not_serviceable', { uber: e.message }); });
      if (q.fee > CFG.max_uber_fee_cents) throw err(400, 'outside_delivery_zone', { uber_fee_cents: q.fee });
      uberQuote = q;
      delivery_fee_cents = customerDeliveryFee(subtotal_cents);
    }

    const tip_cents = Math.min(10000, Math.max(0, Math.round(+b.tip_cents || 0)));
    const tax = taxes(subtotal_cents + delivery_fee_cents);

    // ---- Stripe line items ----
    const cur = (MENU.currency || 'CAD').toLowerCase();
    const line_items = lines.map(l => ({
      quantity: l.qty,
      price_data: { currency: cur, unit_amount: l.unit_cents,
        product_data: { name: lang === 'en' ? l.en : l.fr, ...(l.note ? { description: l.note } : {}) } },
    }));
    if (delivery_fee_cents) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: delivery_fee_cents,
      product_data: { name: lang === 'en' ? 'Delivery' : 'Livraison' } } });
    if (tax.tps_cents) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: tax.tps_cents, product_data: { name: 'TPS 5 %' } } });
    if (tax.tvq_cents) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: tax.tvq_cents, product_data: { name: 'TVQ 9,975 %' } } });
    if (tip_cents) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: tip_cents,
      product_data: { name: lang === 'en' ? (mode === 'delivery' ? 'Courier tip' : 'Tip') : (mode === 'delivery' ? 'Pourboire livreur' : 'Pourboire') } } });

    const metadata = {
      kawtar: 'order', order_status: 'pending_payment', mode, lang,
      customer_name: c.name.slice(0, 80), phone: e164(c.phone), email: String(c.email).slice(0, 120),
      notes: String(b.notes || '').slice(0, 300),
      cart: packCart(lines),
      cart_lines: JSON.stringify(lines.map(l => ({ id: l.id, v: l.variant, qty: l.qty, fr: l.fr, en: l.en, note: l.note }))).slice(0, 500),
      subtotal_cents, delivery_fee_cents, tip_cents, tax_cents: tax.total_cents,
      ...(address ? { address_json: JSON.stringify(address).slice(0, 500), dropoff_notes: address.notes } : {}),
      ...(uberQuote ? { uber_quote_id: uberQuote.id, uber_fee_cents: uberQuote.fee } : {}),
    };

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      locale: lang === 'en' ? 'en' : 'fr-CA',
      customer_email: metadata.email,
      line_items,
      payment_intent_data: { metadata, description: `Kawtar — ${mode === 'delivery' ? 'Livraison' : 'Ramassage'} — ${c.name}` },
      metadata: { kawtar: 'order', mode },
      success_url: `${SITE}/merci.html?s={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/commander.html?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    return res.status(200).json({ url: session.url, id: session.id,
      summary: { subtotal_cents, delivery_fee_cents, tip_cents, tax_cents: tax.total_cents,
                 total_cents: subtotal_cents + delivery_fee_cents + tax.total_cents + tip_cents } });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('checkout failed:', e.message, e.detail || '');
    return res.status(status).json({ error: e.code || 'error', message: e.message, detail: e.detail });
  }
};
