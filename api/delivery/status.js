/* GET /api/delivery/status?id=<delivery_id>  → live status of one delivery */
const { uber, sendError } = require('../_lib/uber');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try {
    const id = (req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'missing_id' });
    const d = await uber(`/deliveries/${encodeURIComponent(id)}`);
    return res.status(200).json({
      delivery_id: d.id, status: d.status, tracking_url: d.tracking_url,
      pickup_eta: d.pickup_eta, dropoff_eta: d.dropoff_eta,
      courier: d.courier || null, complete: !!d.complete,
    });
  } catch (err) { return sendError(res, err); }
};
