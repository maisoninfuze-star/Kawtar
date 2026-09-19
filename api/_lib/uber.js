/* ==========================================================================
   Uber Direct client — shared by /api/delivery/*
   Docs: https://developer.uber.com/docs/deliveries

   Env (Vercel → Settings → Environment Variables, or .env.local for dev):
     UBER_DIRECT_CLIENT_ID       from the Developer tab (Test mode first)
     UBER_DIRECT_CLIENT_SECRET   idem
     UBER_DIRECT_CUSTOMER_ID     Customer ID shown in the Developer dashboard
     UBER_DIRECT_WEBHOOK_SECRET  (optional) signing key for webhook verification
   Restaurant pickup details live below and can be overridden with PICKUP_* vars.
   ========================================================================== */
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const API_BASE  = 'https://api.uber.com/v1/customers';

const PICKUP = {
  name:  process.env.PICKUP_NAME  || 'Café Bistro Kawtar',
  phone: process.env.PICKUP_PHONE || '+15148910831',
  address: {
    street_address: [process.env.PICKUP_STREET || '101 Boulevard de la Concorde Ouest'],
    city:     process.env.PICKUP_CITY   || 'Laval',
    state:    process.env.PICKUP_STATE  || 'QC',
    zip_code: process.env.PICKUP_POSTAL || 'H7N 1H8',
    country:  'CA',
  },
  notes: process.env.PICKUP_NOTES || 'Entrée principale — demander la commande au comptoir.',
};

/* Env lookup tolerant to how the vars get typed in the Vercel UI (Uber_DIRECT_…, UBERDIRECT_…):
   compares names with case and underscores removed, warns when the spelling is off. */
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function envLoose(name) {
  if (process.env[name]) return process.env[name];
  const key = Object.keys(process.env).find(k => norm(k) === norm(name) && process.env[k]);
  if (key) { console.warn(`env: using ${key} for ${name} — rename it to ${name} in Vercel`); return process.env[key]; }
  return '';
}
function env(name) {
  const v = envLoose(name);
  if (!v) throw Object.assign(new Error(`missing env ${name}`), { code: 'not_configured', status: 500 });
  return v;
}

/* ---- OAuth token, cached for the life of the warm function (token lasts ~30 days) ---- */
let cached = { token: null, exp: 0 };
async function getToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: env('UBER_DIRECT_CLIENT_ID'),
    client_secret: env('UBER_DIRECT_CLIENT_SECRET'),
    grant_type: 'client_credentials',
    scope: 'eats.deliveries',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw Object.assign(new Error('uber auth failed: ' + (j.error_description || j.error || r.status)),
      { code: 'auth_failed', status: 502, detail: j });
  }
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

/* ---- authenticated call against /v1/customers/{customer_id}/... ---- */
async function uber(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const url = `${API_BASE}/${env('UBER_DIRECT_CUSTOMER_ID')}${path}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) {
    throw Object.assign(new Error(j.message || j.code || `uber ${method} ${path} → ${r.status}`),
      { code: j.code || 'uber_error', status: r.status, detail: j });
  }
  return j;
}

/* ---- helpers ---- */
// Uber wants the address as a JSON *string*. Accepts our structured object or a plain string.
function addressString(a) {
  if (!a) return null;
  if (typeof a === 'string') return a.trim();
  const street = Array.isArray(a.street_address) ? a.street_address
    : [a.street_address || a.street || a.line1].filter(Boolean);
  return JSON.stringify({
    street_address: street,
    city: a.city,
    state: a.state || a.province || 'QC',
    zip_code: a.zip_code || a.postal_code || a.postal,
    country: a.country || 'CA',
  });
}

// E.164, Canadian default
function phone(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return '+' + d;
}

function isoInMinutes(min) {
  return new Date(Date.now() + Math.max(0, Number(min) || 0) * 60_000).toISOString();
}

function sendError(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('uber-direct:', err.message, err.detail || '');
  return res.status(status).json({ error: err.code || 'error', message: err.message, detail: err.detail });
}

module.exports = { PICKUP, uber, getToken, addressString, phone, isoInMinutes, sendError, envLoose };
