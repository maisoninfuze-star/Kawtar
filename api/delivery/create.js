/* POST /api/delivery/create
   Called AFTER the order is paid. Dispatches an Uber courier.
   Body: {
     quote_id,                       // from /api/delivery/quote (≤15 min old)
     order_id,                       // your order reference (shows on courier app)
     customer: { name, phone, email? },
     dropoff_address: {...} | "string",
     dropoff_notes?,                 // "Sonnez au 2", etc.
     items: [{ name, quantity, price_cents? }],
     prep_minutes?,                  // kitchen prep time → courier arrives when food is ready
     tip_cents?
   }
   → { delivery_id, status, tracking_url, fee, courier?, dropoff_eta } */
const { PICKUP, uber, addressString, phone, isoInMinutes, sendError } = require('../_lib/uber');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const c = b.customer || {};
    const dropoff = addressString(b.dropoff_address);
    const missing = [];
    if (!dropoff) missing.push('dropoff_address');
    if (!c.name) missing.push('customer.name');
    if (!phone(c.phone)) missing.push('customer.phone');
    if (!Array.isArray(b.items) || !b.items.length) missing.push('items');
    if (missing.length) return res.status(400).json({ error: 'missing_fields', missing });

    const manifest_items = b.items.map(it => ({
      name: String(it.name).slice(0, 100),
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
      size: it.size || 'small',
      ...(it.price_cents != null ? { price: Math.round(it.price_cents) } : {}),
    }));

    const payload = {
      pickup_name: PICKUP.name,
      pickup_address: addressString(PICKUP.address),
      pickup_phone_number: PICKUP.phone,
      pickup_notes: PICKUP.notes,
      pickup_business_name: PICKUP.name,
      dropoff_name: String(c.name).slice(0, 80),
      dropoff_address: dropoff,
      dropoff_phone_number: phone(c.phone),
      manifest_items,
      ...(b.quote_id ? { quote_id: b.quote_id } : {}),
      ...(b.dropoff_notes ? { dropoff_notes: String(b.dropoff_notes).slice(0, 280) } : {}),
      ...(b.order_id ? { external_id: String(b.order_id) } : {}),
      ...(b.prep_minutes ? { pickup_ready_dt: isoInMinutes(b.prep_minutes) } : {}),
      ...(b.tip_cents ? { tip: Math.round(b.tip_cents) } : {}),
      // Uber treats prepared food specially (no ID check, keep upright, etc.)
      deliverable_action: 'deliverable_action_meet_at_door',
      undeliverable_action: 'return',
    };

    const d = await uber('/deliveries', { method: 'POST', body: payload });
    return res.status(200).json({
      delivery_id: d.id,
      status: d.status,
      tracking_url: d.tracking_url,
      fee_cents: d.fee,
      fee: d.fee != null ? (Number(d.fee) / 100).toFixed(2) : null,
      currency: d.currency || 'CAD',
      dropoff_eta: d.dropoff_eta,
      pickup_eta: d.pickup_eta,
      courier: d.courier || null,
    });
  } catch (err) { return sendError(res, err); }
};
