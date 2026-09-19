/* ==========================================================================
   POST /api/reserve — Kawtar table reservations (our own system, no third-party form).
   Body: { name, phone, email, date:'YYYY-MM-DD', time:'HH:MM', guests, note?, language?:'fr'|'en', company? (honeypot) }

   What happens on a valid request (each channel independent, failures only logged):
     1. Guest gets a bilingual confirmation e-mail (their language first, the other below)
     2. Restaurant gets an alert e-mail (RESERVE_TO, else ORDER_EMAIL_TO)
     3. Contact is pushed into GoHighLevel via the workflow inbound webhook (CRM record)
   The request succeeds when the restaurant was reached (e-mail or GHL); the guest
   e-mail is reported in the response so the page can tell them to check their inbox.

   Env: SMTP_* (see api/_lib/email.js), RESERVE_TO, GHL_WEBHOOK_URL (optional override)
   ========================================================================== */
const { sendRaw, smtpReady } = require('./_lib/email');
const { MENU } = require('./_lib/menu');

const GHL_WEBHOOK_FALLBACK =
  'https://services.leadconnectorhq.com/hooks/YuXhkj3MjZlhLqUgeeMA/webhook-trigger/6fd483e2-d16f-4e98-a1da-5647d0d7d5e0';

const MAX_LEN = { name: 80, phone: 40, email: 120, guests: 8, note: 500 };
const R = MENU.restaurant;
const SITE = R.site;
const PHONE_DISPLAY = R.phone.replace('+1', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2-$3');
/* closing hour per weekday (Sun=0); null = closed. Same table as js/main.js */
const CLOSING = { 0: 19, 1: null, 2: 19, 3: 20, 4: 21, 5: 22, 6: 22 };

const hits = new Map();                       // naive per-instance rate limit
function tooMany(ip) {
  const now = Date.now(), win = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  if (hits.size > 500) hits.clear();
  return list.length > 8;
}
const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function fmtWhen(date, time, lang) {
  const d = new Date(`${date}T${time}:00`);
  if (isNaN(d)) return `${date} ${time}`;
  const day = new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const t = lang === 'en' ? new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(d) : time.replace(':', ' h ');
  return lang === 'en' ? `${day} at ${t}` : `${day} à ${t}`;
}

/* ---------- guest e-mail: bilingual, requested language first ---------- */
function guestEmail(b) {
  const first = b.name.split(' ')[0];
  const g = b.guests;
  const fr = {
    subject: `Votre réservation chez Café Bistro Kawtar — ${fmtWhen(b.date, b.time, 'fr')}`,
    title: `Merci, ${esc(first)} !`,
    lead: `Votre table est réservée. Nous vous appelons seulement si un ajustement est nécessaire — sinon, nous vous attendons.`,
    rows: [['Date', fmtWhen(b.date, b.time, 'fr')], ['Couverts', g], ['Nom', b.name], ['Téléphone', b.phone], ...(b.note ? [['Note', b.note]] : [])],
    foot: `Un imprévu ? Répondez à ce courriel ou appelez-nous au ${PHONE_DISPLAY}. ${R.address}.`,
    cta: 'Voir le menu',
  };
  const en = {
    subject: `Your reservation at Café Bistro Kawtar — ${fmtWhen(b.date, b.time, 'en')}`,
    title: `Thank you, ${esc(first)}!`,
    lead: `Your table is booked. We'll only call if something needs adjusting — otherwise, see you soon.`,
    rows: [['Date', fmtWhen(b.date, b.time, 'en')], ['Guests', g], ['Name', b.name], ['Phone', b.phone], ...(b.note ? [['Note', b.note]] : [])],
    foot: `Plans changed? Reply to this e-mail or call us at ${PHONE_DISPLAY}. ${R.address}.`,
    cta: 'See the menu',
  };
  const [main, other] = b.language === 'en' ? [en, fr] : [fr, en];
  const block = (c, secondary) => `
    <h${secondary ? 2 : 1} style="margin:0 0 10px;font:normal ${secondary ? 22 : 30}px Georgia,'Times New Roman',serif;color:#2a201a">${c.title}</h${secondary ? 2 : 1}>
    <p style="margin:0 0 16px;font:15px/1.55 Arial,sans-serif;color:#6b5f52">${c.lead}</p>
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;border-left:3px solid #c9a24b;background:#f0e6d3">
      ${c.rows.map(([k, v]) => `<tr><td style="padding:6px 14px 6px 14px;font:12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6b5f52;white-space:nowrap">${esc(k)}</td><td style="padding:6px 14px 6px 4px;font:15px Georgia,serif;color:#2a201a">${esc(v)}</td></tr>`).join('')}
    </table>
    <p style="margin:0 0 ${secondary ? 0 : 8}px;font:13px/1.55 Arial,sans-serif;color:#6b5f52">${c.foot}</p>`;
  const html = `<!doctype html><html lang="${b.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(main.subject)}</title></head>
<body style="margin:0;padding:0;background:#efe7d8">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#efe7d8"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%">
  <tr><td style="background:#15100d;border-radius:14px 14px 0 0;padding:28px 32px 22px;text-align:center">
    <img src="${SITE}/assets/brand/kawtar-lockup.png" width="190" alt="Kawtar Café · Bistro" style="display:block;margin:0 auto 14px;width:190px;border:0">
    <div style="font:11px Arial,sans-serif;letter-spacing:.32em;color:#c9a24b">${b.language === 'en' ? 'RESERVATION · RÉSERVATION' : 'RÉSERVATION · RESERVATION'}</div>
  </td></tr>
  <tr><td style="background:#f7f1e6;padding:34px 32px 26px">${block(main, false)}
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:14px 0 26px"><tr><td style="background:#c9a24b;border-radius:999px">
      <a href="${SITE}/#p-menu" style="display:inline-block;padding:13px 26px;font:bold 12px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#15100d;text-decoration:none">${main.cta}</a></td></tr></table>
    <div style="border-top:1px solid #e6dccb;margin:0 0 24px"></div>
    ${block(other, true)}
  </td></tr>
  <tr><td style="background:#15100d;border-radius:0 0 14px 14px;padding:22px 32px;text-align:center">
    <div style="font:15px Georgia,serif;color:#f4ead8">${esc(R.name)}</div>
    <div style="font:12px/1.7 Arial,sans-serif;color:#a89c8a">${esc(R.address)}<br>
      <a href="tel:${R.phone}" style="color:#e3c785;text-decoration:none">${PHONE_DISPLAY}</a> · <a href="${SITE}" style="color:#e3c785;text-decoration:none">kawtar.ca</a><br>
      Mar.–dim. dès 9 h · Lundi fermé &nbsp;|&nbsp; Tue–Sun from 9 am · Closed Mondays</div>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = [main.title, main.lead, ...main.rows.map(([k, v]) => `${k}: ${v}`), main.foot, '', '—', '', other.title, other.lead, ...other.rows.map(([k, v]) => `${k}: ${v}`), other.foot, '', R.name, R.address, PHONE_DISPLAY].join('\n');
  return { subject: main.subject, html, text };
}

function restaurantEmail(b) {
  const when = fmtWhen(b.date, b.time, 'fr');
  return {
    subject: `🍽️ Réservation ${when} · ${b.guests} pers. · ${b.name}`,
    text: `Nouvelle réservation via kawtar.ca\n\nQuand : ${when}\nCouverts : ${b.guests}\nNom : ${b.name}\nTéléphone : ${b.phone}\nCourriel : ${b.email}\nLangue : ${b.language === 'en' ? 'English' : 'Français'}\nNote : ${b.note || '—'}\n\nLe client a reçu une confirmation automatique (FR/EN). Appelez-le seulement si l’heure doit changer.`,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (body.company) return res.status(200).json({ ok: true });          // honeypot: bot

    const b = {
      name: clean(body.name, MAX_LEN.name), phone: clean(body.phone, MAX_LEN.phone), email: clean(body.email, MAX_LEN.email).toLowerCase(),
      date: clean(body.date, 10), time: clean(body.time, 5), guests: clean(body.guests, MAX_LEN.guests) || '2',
      note: clean(body.note, MAX_LEN.note), language: body.language === 'en' ? 'en' : 'fr',
    };
    const missing = ['name', 'phone', 'email', 'date', 'time'].filter(k => !b[k]);
    if (missing.length) return res.status(400).json({ error: 'missing_fields', missing });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) return res.status(400).json({ error: 'bad_email' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) return res.status(400).json({ error: 'bad_datetime' });
    if (!/\d{7,}/.test(b.phone.replace(/\D/g, ''))) return res.status(400).json({ error: 'bad_phone' });
    const when = new Date(`${b.date}T${b.time}:00`);
    if (isNaN(when)) return res.status(400).json({ error: 'bad_datetime' });
    const close = CLOSING[new Date(`${b.date}T12:00:00`).getDay()];
    const minutes = +b.time.slice(0, 2) * 60 + +b.time.slice(3);
    if (close === null) return res.status(400).json({ error: 'closed_day' });
    if (minutes < 9 * 60 || minutes > (close - 1) * 60) return res.status(400).json({ error: 'outside_hours' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (tooMany(ip)) return res.status(429).json({ error: 'rate_limited' });

    const inbox = (process.env.RESERVE_TO || process.env.ORDER_EMAIL_TO || '').trim();
    const ghlUrl = process.env.GHL_WEBHOOK_URL || GHL_WEBHOOK_FALLBACK;
    const results = { guest_email: false, restaurant_email: false, ghl: false };

    // 1. guest confirmation (FR/EN)
    if (smtpReady()) {
      const m = guestEmail(b);
      results.guest_email = await sendRaw({ to: b.email, replyTo: inbox || undefined, subject: m.subject, html: m.html, text: m.text, tag: 'reservation' });
    } else console.warn('reserve: SMTP not configured — guest confirmation skipped');

    // 2. restaurant alert
    if (smtpReady() && inbox) {
      const m = restaurantEmail(b);
      results.restaurant_email = await sendRaw({ to: inbox, replyTo: b.email, subject: m.subject, text: m.text, tag: 'reservation-alert' });
    }

    // 3. GoHighLevel CRM record (workflow inbound webhook)
    if (ghlUrl) {
      try {
        const parts = b.name.split(' ');
        const r = await fetch(ghlUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          first_name: parts[0], last_name: parts.slice(1).join(' '), full_name: b.name, phone: b.phone, email: b.email,
          reservation_date: b.date, reservation_time: b.time, reservation_when: fmtWhen(b.date, b.time, 'fr'),
          guests: b.guests, note: b.note, language: b.language, confirmation_email_sent: results.guest_email,
          source: 'kawtar.ca — formulaire de réservation', submitted_at: new Date().toISOString(),
        }) });
        results.ghl = r.ok;
        if (!r.ok) console.error('reserve: GHL returned HTTP', r.status);
      } catch (e) { console.error('reserve: GHL post failed:', e && e.message); }
    }

    console.log('reserve:', JSON.stringify({ when: `${b.date} ${b.time}`, guests: b.guests, lang: b.language, ...results }));
    if (!results.restaurant_email && !results.ghl) {
      console.error('reserve: nobody reached — booking NOT recorded');
      return res.status(502).json({ error: 'delivery_failed' });
    }
    return res.status(200).json({ ok: true, ...results });
  } catch (e) {
    console.error('reserve: failed', e && e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
