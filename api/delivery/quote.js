/* POST /api/delivery/quote
   Body: { dropoff_address: {street_address, city, state, zip_code} | "string", prep_minutes? }
   → { quote_id, fee_cents, fee, currency, dropoff_eta, duration_minutes, expires }
   Call this BEFORE checkout to show the customer the delivery fee + ETA.
   A quote is valid for 15 minutes; create the delivery with its quote_id. */
const { PICKUP, uber, addressString, isoInMinutes, sendError } = require('../_lib/uber');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const dropoff = addressString(body.dropoff_address);
    if (!dropoff) return res.status(400).json({ error: 'missing_dropoff_address' });

    const payload = {
      pickup_address: addressString(PICKUP.address),
      dropoff_address: dropoff,
    };
    // tell Uber when the kitchen will have it ready so the ETA is realistic
    if (body.prep_minutes) payload.pickup_ready_dt = isoInMinutes(body.prep_minutes);

    const q = await uber('/delivery_quotes', { method: 'POST', body: payload });
    return res.status(200).json({
      quote_id: q.id,
      fee_cents: q.fee,
      fee: (Number(q.fee) / 100).toFixed(2),
      currency: q.currency || 'CAD',
      dropoff_eta: q.dropoff_eta,
      duration_minutes: q.duration,
      pickup_duration_minutes: q.pickup_duration,
      expires: q.expires,
    });
  } catch (err) { return sendError(res, err); }
};
