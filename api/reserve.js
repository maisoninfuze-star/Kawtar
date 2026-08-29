/* ==========================================================================
   POST /api/reserve — Kawtar reservation intake (our own system)
   Validates the request, blocks bots, then emails the restaurant through the
   restaurant's own mailbox over SMTP. No third-party form service involved.

   Required env vars (Vercel → Settings → Environment Variables):
     SMTP_HOST      e.g. smtp.gmail.com
     SMTP_PORT      587
     SMTP_USER      the mailbox address used to send
     SMTP_PASS      app password for that mailbox (NOT the normal password)
     RESERVE_TO     where bookings should land (can be several, comma-separated)
   Optional:
     RESERVE_FROM   From: header (defaults to SMTP_USER)
   ========================================================================== */
const nodemailer = require('nodemailer');

const MAX_LEN = { name: 80, phone: 40, guests: 8, note: 500 };
const hits = new Map();                     // naive per-instance rate limit

function tooMany(ip) {
  const now = Date.now(), win = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) hits.clear();        // keep memory bounded
  return list.length > 8;                   // max 8 reservations/hour/IP
}

const esc = s => String(s == null ? '' : s)
  .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, phone, date, time, guests, note, company, language } = body;

    if (company) return res.status(200).json({ ok: true });          // honeypot: bot

    const missing = ['name', 'phone', 'date', 'time'].filter(k => !String(body[k] || '').trim());
    if (missing.length) return res.status(400).json({ error: 'missing_fields', missing });

    for (const [k, max] of Object.entries(MAX_LEN)) {
      if (body[k] && String(body[k]).length > max) {
        return res.status(400).json({ error: 'field_too_long', field: k });
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: 'bad_datetime' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (tooMany(ip)) return res.status(429).json({ error: 'rate_limited' });

    const need = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'RESERVE_TO'];
    const unset = need.filter(k => !process.env[k]);
    if (unset.length) {
      console.error('reserve: missing env vars', unset.join(', '));
      return res.status(500).json({ error: 'not_configured' });
    }

    const when = new Date(`${date}T${time}`);
    const pretty = isNaN(when) ? `${date} ${time}`
      : when.toLocaleString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

    const rows = [
      ['Nom', name], ['Téléphone', phone], ['Date & heure', pretty],
      ['Couverts', guests || '—'], ['Note', note || '—'],
      ['Langue', language === 'en' ? 'English' : 'Français'],
    ];

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"Réservations — kawtar.ca" <${process.env.RESERVE_FROM || process.env.SMTP_USER}>`,
      to: process.env.RESERVE_TO,
      replyTo: process.env.RESERVE_TO,
      subject: `Réservation — ${name} · ${guests || '?'} couverts · ${date} ${time}`,
      text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nReçu via kawtar.ca`,
      html: `<div style="font-family:Georgia,serif;max-width:520px;background:#15100d;color:#f3e9d8;padding:26px;border:1px solid #c9a24b">
        <h2 style="margin:0 0 4px;color:#e3c785;font-weight:normal;letter-spacing:.06em">Nouvelle réservation</h2>
        <p style="margin:0 0 18px;color:#c5b69d;font-size:13px">Reçue via kawtar.ca</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          ${rows.map(([k, v]) => `<tr>
            <td style="padding:8px 0;color:#c9a24b;width:38%;vertical-align:top">${k}</td>
            <td style="padding:8px 0;color:#f3e9d8">${esc(v)}</td></tr>`).join('')}
        </table>
        <p style="margin:20px 0 0"><a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}"
          style="color:#e3c785">Appeler ${esc(name)}</a></p>
      </div>`,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('reserve failed:', err && err.message);
    return res.status(502).json({ error: 'send_failed' });
  }
};
