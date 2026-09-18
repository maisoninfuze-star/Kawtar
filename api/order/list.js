/* GET /api/order/list?scope=open|today   (X-Kitchen-Pin) */
const { requirePin } = require('../_lib/kitchen-auth');
const { listOrders, OPEN } = require('../_lib/orders');
module.exports = async (req, res) => {
  if (!requirePin(req, res)) return;
  try {
    const scope = (req.query && req.query.scope) || 'open';
    const orders = await listOrders({ sinceHours: scope === 'open' ? 36 : 24, statuses: scope === 'open' ? OPEN : null });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ orders, at: Date.now() });
  } catch (e) { console.error('list failed', e.message); return res.status(e.status || 500).json({ error: e.code || 'error', message: e.message }); }
};
