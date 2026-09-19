#!/usr/bin/env node
/* Renders every customer/restaurant e-mail for a sample order to ./out (or argv[2]),
   and dry-runs the send path through nodemailer's JSON transport.
   Usage: node scripts/preview-emails.js [outDir]   — set SMTP_* + TEST_EMAIL_TO to really send. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const line of (fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8') : '').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const REAL = !!process.env.TEST_EMAIL_TO;
if (!REAL) process.env.EMAIL_DRY_RUN = '1';
const { renderCustomerEmail, renderRestaurantEmail, sendCustomerEmail, sendRestaurantEmail } = require('../api/_lib/email');
const out = process.argv[2] || path.join(ROOT, 'out'); fs.mkdirSync(out, { recursive: true });

const base = (lang, mode) => ({
  id: 'pi_test', order_no: 'K-WZ9N', status: 'new', lang, mode, paid: true, amount_cents: 4436, created: Date.now(),
  customer: { name: 'Sara Benali', phone: '+15145550199', email: process.env.TEST_EMAIL_TO || 'client@example.com' },
  address: mode === 'delivery' ? { street: '1555 Boul. Chomedey', city: 'Laval', postal: 'H7V 3Z1' } : null,
  dropoff_notes: mode === 'delivery' ? 'Sonner 2 fois' : '', notes: 'Sans coriandre s.v.p.',
  cart_lines: [{ id: 'tajine-bouzroug', qty: 1, fr: 'Tajine Bouzroug', en: 'Bouzroug Tajine (mussels)', note: '' },
               { id: 'the-marocain', v: 'moyen', qty: 1, fr: 'Thé Marocain traditionnel — Moyen', en: 'Traditional Moroccan Tea — Medium', note: 'peu sucré' }],
  subtotal_cents: 2898, delivery_fee_cents: mode === 'delivery' ? 699 : 0, tip_cents: 300, tax_cents: 539,
  prep_minutes: 15, ready_at: new Date(Date.now() + 15 * 60000).toISOString(), session_id: 'cs_test_example',
  uber: mode === 'delivery' ? { id: 'del_x', status: 'pickup', tracking_url: 'https://direct-order.uber.com/ca/orders/example', eta: new Date(Date.now() + 40 * 60000).toISOString() } : null,
});
(async () => {
  let n = 0;
  for (const lang of ['fr', 'en']) for (const mode of ['pickup', 'delivery']) {
    const o = base(lang, mode);
    for (const ev of ['order_paid', 'order_accepted', 'order_ready', 'order_dispatched', 'order_cancelled']) {
      if (mode === 'pickup' && ev === 'order_dispatched') continue;
      const m = renderCustomerEmail(o, ev, { reason: 'Rupture de stock' });
      fs.writeFileSync(path.join(out, `${lang}-${mode}-${ev}.html`), m.html); n++;
      const ok = await sendCustomerEmail(o, ev, { reason: 'Rupture de stock' });
      console.log(`${ok ? '✓' : '✗'} ${lang} ${mode.padEnd(8)} ${ev.padEnd(16)} "${m.subject}"`);
      if (REAL) break;   // one real email per lang/mode is enough
    }
  }
  const o = base('fr', 'delivery');
  for (const ev of ['order_paid', 'delivery_problem', 'order_cancelled']) {
    const m = renderRestaurantEmail(o, ev, { detail: 'Courier canceled', reason: 'Test' });
    fs.writeFileSync(path.join(out, `restaurant-${ev}.txt`), m.subject + '\n\n' + m.text); n++;
    if (process.env.ORDER_EMAIL_TO) console.log((await sendRestaurantEmail(o, ev, { detail: 'Courier canceled', reason: 'Test' }) ? '✓' : '✗'), 'restaurant', ev);
  }
  console.log(`\n${n} files → ${out}${REAL ? '' : '  (dry run — set SMTP_* and TEST_EMAIL_TO to send for real)'}`);
})().catch(e => { console.error(e); process.exit(1); });
