/* POST /api/order/test-email  (X-Kitchen-Pin)
   { to, lang?: 'fr'|'en', mode?: 'pickup'|'delivery', event?: order_paid|order_accepted|order_ready|order_dispatched|order_cancelled }
   Sends the real customer e-mail template for a sample order — verifies SMTP in
   production without placing a paid order. Also GET → { smtp: bool, restaurant_inbox: bool } */
const { requirePin } = require('../_lib/kitchen-auth');
const { sendCustomerEmail, smtpReady, smtp } = require('../_lib/email');

function sampleOrder(lang, mode, to) {
  const delivery = mode === 'delivery';
  return {
    id: 'pi_sample', order_no: 'K-TEST', status: 'accepted', lang, mode, paid: true, amount_cents: delivery ? 4436 : 3437, created: Date.now(),
    customer: { name: 'Test Kawtar', phone: '+15148910831', email: to },
    address: delivery ? { street: '1555 Boul. Chomedey', city: 'Laval', postal: 'H7V 3Z1' } : null,
    dropoff_notes: delivery ? 'Sonner 2 fois' : '', notes: '',
    cart_lines: [{ id: 'tajine-bouzroug', qty: 1, fr: 'Tajine Bouzroug', en: 'Bouzroug Tajine (mussels)', note: '' },
                 { id: 'the-marocain', v: 'moyen', qty: 1, fr: 'Thé Marocain traditionnel — Moyen', en: 'Traditional Moroccan Tea — Medium', note: '' }],
    subtotal_cents: 2898, delivery_fee_cents: delivery ? 699 : 0, tip_cents: delivery ? 300 : 0, tax_cents: delivery ? 539 : 434,
    prep_minutes: 20, ready_at: new Date(Date.now() + 20 * 60000).toISOString(), session_id: '',
    uber: delivery ? { id: 'del_sample', status: 'pickup', tracking_url: 'https://direct-order.uber.com/ca/orders/exemple-de-suivi', eta: new Date(Date.now() + 45 * 60000).toISOString() } : null,
  };
}

module.exports = async (req, res) => {
  if (!requirePin(req, res)) return;
  if (req.method === 'GET') {
    const c = smtp();
    return res.status(200).json({ smtp: smtpReady(), host: c.host, port: c.port, user: c.user ? c.user.replace(/^(..).*(@.*)$/, '$1…$2') : '', pass_len: c.pass.length,
      restaurant_inbox: !!(process.env.ORDER_EMAIL_TO || '').trim() });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.to || ''))) return res.status(400).json({ error: 'bad_email' });
  if (!smtpReady()) return res.status(503).json({ error: 'smtp_not_configured', need: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] });
  const lang = b.lang === 'en' ? 'en' : 'fr', mode = b.mode === 'pickup' ? 'pickup' : 'delivery';
  const event = ['order_paid', 'order_accepted', 'order_ready', 'order_dispatched', 'order_cancelled'].includes(b.event) ? b.event : 'order_dispatched';
  const ok = await sendCustomerEmail(sampleOrder(lang, mode, b.to), event, { reason: 'Test' });
  return res.status(ok ? 200 : 502).json({ ok, event, lang, mode, to: b.to });
};
