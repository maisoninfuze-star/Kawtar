#!/usr/bin/env node
/* End-to-end Uber Direct sandbox test: token → quote → create delivery → status.
   Reads credentials from .env.local (gitignored) or the environment.
     node scripts/uber-sandbox-test.js
   Nothing is charged and no real courier is dispatched with Test-mode credentials. */
const fs = require('fs'), path = require('path');

// tiny .env.local loader (no dependency)
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { PICKUP, getToken, uber, addressString, phone, isoInMinutes } = require('../api/_lib/uber');

// a real Laval address a few km from the restaurant
const DROPOFF = { street_address: ['1555 Boulevard Chomedey'], city: 'Laval', state: 'QC', zip_code: 'H7V 3Z1', country: 'CA' };

(async () => {
  const t0 = Date.now();
  const step = (s) => console.log(`\n▸ ${s}`);

  step('1/4  OAuth token');
  const token = await getToken();
  console.log('   token ok  (' + token.slice(0, 12) + '…)');

  step('2/4  Quote  Kawtar → ' + DROPOFF.street_address[0]);
  const q = await uber('/delivery_quotes', { method: 'POST', body: {
    pickup_address: addressString(PICKUP.address),
    dropoff_address: addressString(DROPOFF),
    pickup_ready_dt: isoInMinutes(20),           // 20 min prep time
  }});
  console.log(`   quote ${q.id}`);
  console.log(`   fee ${(q.fee/100).toFixed(2)} ${q.currency || 'CAD'}  ·  ETA ${q.dropoff_eta}  ·  duration ${q.duration} min`);

  step('3/4  Create delivery (sandbox — robo-courier)');
  const d = await uber('/deliveries', { method: 'POST', body: {
    quote_id: q.id,
    pickup_name: PICKUP.name, pickup_address: addressString(PICKUP.address),
    pickup_phone_number: PICKUP.phone, pickup_notes: PICKUP.notes,
    dropoff_name: 'Test Client', dropoff_address: addressString(DROPOFF),
    dropoff_phone_number: phone('514 555 0199'), dropoff_notes: 'TEST sandbox — ignorer',
    manifest_items: [
      { name: 'Tajine Poulet, Olives & Frites', quantity: 1, size: 'small', price: 2199 },
      { name: 'Thé marocain (grand)', quantity: 1, size: 'small', price: 1299 },
    ],
    external_id: 'TEST-' + Date.now(),
    pickup_ready_dt: isoInMinutes(20),
    deliverable_action: 'deliverable_action_meet_at_door', undeliverable_action: 'return',
  }});
  console.log(`   delivery ${d.id}  status=${d.status}`);
  console.log(`   fee ${d.fee != null ? (d.fee/100).toFixed(2) : '?'} ${d.currency || 'CAD'}`);
  console.log(`   tracking → ${d.tracking_url}`);

  step('4/4  Read it back');
  const s = await uber(`/deliveries/${d.id}`);
  console.log(`   status=${s.status}  pickup_eta=${s.pickup_eta}  dropoff_eta=${s.dropoff_eta}`);

  console.log(`\n✓ Uber Direct sandbox works end to end  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
})().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  if (e.detail) console.error('  detail:', JSON.stringify(e.detail, null, 2));
  process.exit(1);
});
