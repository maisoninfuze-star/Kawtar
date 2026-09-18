/* Server-side menu + pricing. The browser only sends item ids and quantities;
   every price, fee and tax is recomputed here from data/menu.json. */
const path = require('path');
const MENU = require(path.join(__dirname, '..', '..', 'data', 'menu.json'));
const CFG = MENU.ordering;

const index = new Map();
for (const c of MENU.categories) for (const it of c.items) index.set(it.id, { ...it, category: c.id, cat: c });

function couscousOpenToday(now = new Date()) {
  const c = MENU.categories.find(x => x.id === 'couscous');
  if (!c || !c.available_days) return true;
  // restaurant local time (America/Toronto)
  const day = new Date(now.toLocaleString('en-US', { timeZone: 'America/Toronto' })).getDay();
  return c.available_days.includes(day);
}

/* cart: [{ id, qty, variant? , note? }]  →  { lines, subtotal_cents } or throws */
function priceCart(cart) {
  if (!Array.isArray(cart) || !cart.length) throw err(400, 'empty_cart');
  if (cart.length > 40) throw err(400, 'cart_too_large');
  const lines = [];
  for (const raw of cart) {
    const it = index.get(String(raw.id || ''));
    if (!it) throw err(400, 'unknown_item', { id: raw.id });
    const qty = Math.min(20, Math.max(1, parseInt(raw.qty, 10) || 1));
    let unit = it.price_cents, label_fr = it.fr, label_en = it.en, variant = null;
    if (it.variants && it.variants.length) {
      variant = it.variants.find(v => v.id === raw.variant) || it.variants[0];
      unit = variant.price_cents; label_fr += ` — ${variant.fr}`; label_en += ` — ${variant.en}`;
    }
    if (it.category === 'couscous' && !couscousOpenToday()) throw err(400, 'couscous_not_today', { id: it.id });
    lines.push({ id: it.id, variant: variant && variant.id, qty, unit_cents: unit, total_cents: unit * qty,
                 fr: label_fr, en: label_en, note: raw.note ? String(raw.note).slice(0, 120) : '' });
  }
  const subtotal_cents = lines.reduce((s, l) => s + l.total_cents, 0);
  if (subtotal_cents < CFG.min_order_cents) throw err(400, 'below_minimum', { min_cents: CFG.min_order_cents });
  return { lines, subtotal_cents };
}

/* What the customer pays for delivery (flat, free over threshold). */
function customerDeliveryFee(subtotal_cents) {
  return subtotal_cents >= CFG.free_delivery_over_cents ? 0 : CFG.delivery_fee_cents;
}

/* Quebec sales taxes on food + delivery fee (tips are not taxed). */
function taxes(taxable_cents) {
  const tps = Math.round(taxable_cents * CFG.tax.tps);
  const tvq = Math.round(taxable_cents * CFG.tax.tvq);
  return { tps_cents: tps, tvq_cents: tvq, total_cents: tps + tvq };
}

function err(status, code, extra) {
  return Object.assign(new Error(code), { status, code, ...(extra ? { detail: extra } : {}) });
}

module.exports = { MENU, CFG, index, priceCart, customerDeliveryFee, taxes, couscousOpenToday, err };
