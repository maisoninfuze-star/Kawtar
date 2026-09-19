/* Transactional e-mails for online orders — sent by us, no third-party workflow needed.
   Customer gets: paid (confirmation) → accepted (ready time / courier booked)
   → ready (pickup) | dispatched (delivery, with the Uber tracking link) → cancelled (refund).
   Restaurant gets: new order, delivery problem.

   Env (Vercel → Environment Variables):
     SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   any SMTP (Gmail: smtp.gmail.com, 465, app password)
     EMAIL_FROM        optional, default "Café Bistro Kawtar <SMTP_USER>"
     ORDER_EMAIL_TO    restaurant inbox for new-order / problem alerts (also the customer reply-to)
     EMAIL_DRY_RUN=1   render only (tests) — nothing is sent                                     */
const { MENU } = require('./menu');

const SITE = MENU.restaurant.site;
const BRAND = { bg: '#15100d', panel: '#1d1712', gold: '#c9a24b', gold2: '#e3c785', cream: '#f4ead8', dim: '#a89c8a', red: '#9e2b25', paper: '#f7f1e6', ink: '#2a201a', ink2: '#6b5f52' };

const money = c => (c / 100).toFixed(2).replace('.', ',') + ' $';
const moneyEn = c => '$' + (c / 100).toFixed(2);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const first = o => (o.customer && o.customer.name || '').trim().split(/\s+/)[0] || '';
const fmtTime = (iso, lang) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).format(new Date(iso)); }
  catch { return ''; }
};
const statusUrl = o => o.session_id ? `${SITE}/merci.html?s=${encodeURIComponent(o.session_id)}` : `${SITE}/commander.html`;
const trackingUrl = o => (o.uber && o.uber.tracking_url) || '';
const addressLine = o => o.address ? [o.address.street, o.address.city, o.address.postal].filter(Boolean).join(', ') : '';

/* ---------------- copy (FR / EN) ---------------- */
function copy(o, event, extra = {}) {
  const en = o.lang === 'en', n = o.order_no, name = first(o), when = fmtTime(o.ready_at, o.lang);
  const eta = fmtTime(o.uber && o.uber.eta, o.lang);
  const delivery = o.mode === 'delivery';
  const track = trackingUrl(o);
  const R = MENU.restaurant;
  const fr = {
    order_paid: {
      subject: `Commande ${n} reçue — Café Bistro Kawtar`,
      title: name ? `Merci, ${name} !` : 'Merci !',
      lead: 'Nous avons bien reçu votre commande et votre paiement. La cuisine la prend en charge dans un instant.',
      info: delivery ? `Livraison à ${addressLine(o)}` : `À ramasser au comptoir · ${R.address}`,
      cta: { label: 'Suivre ma commande', url: statusUrl(o) },
    },
    order_accepted: {
      subject: `Votre commande ${n} est en préparation`,
      title: 'C’est parti en cuisine !',
      lead: delivery
        ? `Votre commande sera prête vers <b>${when}</b>. Un livreur Uber viendra la chercher à ce moment-là — vous pourrez le suivre en direct.`
        : `Votre commande sera prête vers <b>${when}</b>. Nous vous écrirons dès qu’elle est prête au comptoir.`,
      info: delivery ? `Livraison à ${addressLine(o)}` : `Ramassage · ${R.address}`,
      cta: track ? { label: 'Suivre ma livraison', url: track } : { label: 'Suivre ma commande', url: statusUrl(o) },
    },
    order_ready: {
      subject: delivery ? `Votre commande ${n} est prête — le livreur arrive` : `Votre commande ${n} est prête !`,
      title: delivery ? 'Prête — le livreur arrive' : 'Votre commande est prête !',
      lead: delivery ? 'Votre commande est emballée et attend le livreur au comptoir.' : `Passez la chercher au comptoir : ${R.address}. Mentionnez simplement votre nom ou le numéro <b>${n}</b>.`,
      info: delivery ? `Livraison à ${addressLine(o)}` : `Ouvert mar.–dim. dès 9 h · ${R.phone.replace('+1', '')}`,
      cta: track ? { label: 'Suivre ma livraison', url: track } : { label: 'Voir ma commande', url: statusUrl(o) },
    },
    order_dispatched: {
      subject: `Votre commande ${n} est en route 🛵`,
      title: 'Votre commande est en route',
      lead: `Le livreur a récupéré votre commande${eta ? ` — arrivée prévue vers <b>${eta}</b>` : ''}. Suivez-le en direct sur la carte Uber.`,
      info: `Livraison à ${addressLine(o)}${o.dropoff_notes ? ` · ${o.dropoff_notes}` : ''}`,
      cta: track ? { label: 'Suivre ma livraison sur Uber', url: track } : { label: 'Suivre ma commande', url: statusUrl(o) },
    },
    order_cancelled: {
      subject: `Commande ${n} annulée — remboursement émis`,
      title: 'Commande annulée',
      lead: `Nous sommes désolés : nous avons dû annuler votre commande${extra.reason ? ` (${esc(extra.reason)})` : ''}. Le remboursement complet de <b>${money(o.amount_cents)}</b> a été émis sur votre carte ; il apparaît sur votre relevé dans 5 à 10 jours ouvrables.`,
      info: `Une question ? Appelez-nous au ${R.phone.replace('+1', '')}.`,
      cta: { label: 'Commander à nouveau', url: `${SITE}/commander.html` },
    },
  };
  const enCopy = {
    order_paid: {
      subject: `Order ${n} received — Café Bistro Kawtar`,
      title: name ? `Thank you, ${name}!` : 'Thank you!',
      lead: 'We’ve received your order and payment. The kitchen is picking it up right now.',
      info: delivery ? `Delivery to ${addressLine(o)}` : `Pickup at the counter · ${R.address}`,
      cta: { label: 'Track my order', url: statusUrl(o) },
    },
    order_accepted: {
      subject: `Your order ${n} is being prepared`,
      title: 'It’s in the kitchen!',
      lead: delivery
        ? `Your order will be ready around <b>${when}</b>. An Uber courier will pick it up then — you can follow them live.`
        : `Your order will be ready around <b>${when}</b>. We’ll email you the moment it’s at the counter.`,
      info: delivery ? `Delivery to ${addressLine(o)}` : `Pickup · ${R.address}`,
      cta: track ? { label: 'Track my delivery', url: track } : { label: 'Track my order', url: statusUrl(o) },
    },
    order_ready: {
      subject: delivery ? `Your order ${n} is ready — courier on the way` : `Your order ${n} is ready!`,
      title: delivery ? 'Ready — courier arriving' : 'Your order is ready!',
      lead: delivery ? 'Your order is packed and waiting for the courier at the counter.' : `Come pick it up at the counter: ${R.address}. Just give your name or order number <b>${n}</b>.`,
      info: delivery ? `Delivery to ${addressLine(o)}` : `Open Tue–Sun from 9 am · ${R.phone.replace('+1', '')}`,
      cta: track ? { label: 'Track my delivery', url: track } : { label: 'View my order', url: statusUrl(o) },
    },
    order_dispatched: {
      subject: `Your order ${n} is on its way 🛵`,
      title: 'Your order is on its way',
      lead: `The courier has picked up your order${eta ? ` — arriving around <b>${eta}</b>` : ''}. Follow them live on the Uber map.`,
      info: `Delivery to ${addressLine(o)}${o.dropoff_notes ? ` · ${o.dropoff_notes}` : ''}`,
      cta: track ? { label: 'Track my delivery on Uber', url: track } : { label: 'Track my order', url: statusUrl(o) },
    },
    order_cancelled: {
      subject: `Order ${n} cancelled — refund issued`,
      title: 'Order cancelled',
      lead: `We’re sorry — we had to cancel your order${extra.reason ? ` (${esc(extra.reason)})` : ''}. A full refund of <b>${moneyEn(o.amount_cents)}</b> has been issued to your card; it shows on your statement within 5–10 business days.`,
      info: `Questions? Call us at ${R.phone.replace('+1', '')}.`,
      cta: { label: 'Order again', url: `${SITE}/commander.html` },
    },
  };
  return (en ? enCopy : fr)[event] || null;
}

/* ---------------- HTML ---------------- */
function recapRows(o) {
  const en = o.lang === 'en', m = en ? moneyEn : money;
  const lines = (o.cart_lines || []).map(l =>
    `<tr><td style="padding:6px 0;color:${BRAND.ink};font:15px Georgia,serif">${l.qty}× ${esc(en ? l.en : l.fr)}${l.note ? `<div style="font:13px Arial,sans-serif;color:${BRAND.ink2}">${esc(l.note)}</div>` : ''}</td></tr>`).join('');
  const row = (k, v, strong) => `<tr><td style="padding:4px 0;font:${strong ? 'bold 16px Georgia,serif' : '14px Arial,sans-serif'};color:${strong ? BRAND.ink : BRAND.ink2}">${k}</td><td align="right" style="padding:4px 0;font:${strong ? 'bold 16px Georgia,serif' : '14px Arial,sans-serif'};color:${strong ? BRAND.ink : BRAND.ink2}">${v}</td></tr>`;
  const totals = [
    row(en ? 'Subtotal' : 'Sous-total', m(o.subtotal_cents)),
    o.delivery_fee_cents ? row(en ? 'Delivery' : 'Livraison', m(o.delivery_fee_cents)) : '',
    row(en ? 'GST + QST' : 'TPS + TVQ', m(o.tax_cents)),
    o.tip_cents ? row(en ? 'Tip' : 'Pourboire', m(o.tip_cents)) : '',
    row(en ? 'Total paid' : 'Total payé', m(o.amount_cents), true),
  ].join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${lines}
    <tr><td style="padding:10px 0"><div style="border-top:1px solid #e6dccb"></div></td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${totals}</table>`;
}

function layout(o, c, { recap = true } = {}) {
  const en = o.lang === 'en';
  const R = MENU.restaurant;
  const modeTag = o.mode === 'delivery' ? (en ? 'DELIVERY' : 'LIVRAISON') : (en ? 'PICKUP' : 'RAMASSAGE');
  return `<!doctype html><html lang="${en ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#efe7d8">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#efe7d8"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%">
  <tr><td style="background:${BRAND.bg};border-radius:14px 14px 0 0;padding:28px 32px 22px;text-align:center">
    <img src="${SITE}/assets/brand/kawtar-lockup.png" width="190" alt="Kawtar Café · Bistro" style="display:block;margin:0 auto 14px;width:190px;border:0">
    <div style="font:11px Arial,sans-serif;letter-spacing:.32em;color:${BRAND.gold}">${en ? 'ORDER' : 'COMMANDE'} ${esc(o.order_no)} · ${modeTag}</div>
  </td></tr>
  <tr><td style="background:${BRAND.paper};padding:34px 32px 8px">
    <h1 style="margin:0 0 12px;font:normal 30px Georgia,'Times New Roman',serif;color:${BRAND.ink};letter-spacing:-.01em">${c.title}</h1>
    <p style="margin:0 0 18px;font:16px/1.55 Arial,sans-serif;color:${BRAND.ink2}">${c.lead}</p>
    ${c.info ? `<p style="margin:0 0 22px;padding:12px 14px;background:#f0e6d3;border-left:3px solid ${BRAND.gold};font:14px/1.5 Arial,sans-serif;color:${BRAND.ink}">${esc(c.info)}</p>` : ''}
    ${c.cta ? `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 26px"><tr><td style="background:${BRAND.gold};border-radius:999px">
      <a href="${c.cta.url}" style="display:inline-block;padding:14px 28px;font:bold 13px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${BRAND.bg};text-decoration:none">${esc(c.cta.label)}</a></td></tr></table>
      <p style="margin:-14px 0 24px;font:12px Arial,sans-serif;color:${BRAND.ink2};word-break:break-all">${en ? 'Link' : 'Lien'} : <a href="${c.cta.url}" style="color:${BRAND.red}">${esc(c.cta.url)}</a></p>` : ''}
  </td></tr>
  ${recap ? `<tr><td style="background:${BRAND.paper};padding:0 32px 30px">
    <div style="font:11px Arial,sans-serif;letter-spacing:.28em;color:${BRAND.ink2};margin:0 0 10px">${en ? 'YOUR ORDER' : 'VOTRE COMMANDE'}</div>
    ${recapRows(o)}
    ${o.notes ? `<p style="margin:14px 0 0;font:13px/1.5 Arial,sans-serif;color:${BRAND.ink2}"><b>${en ? 'Note' : 'Note'} :</b> ${esc(o.notes)}</p>` : ''}
  </td></tr>` : ''}
  <tr><td style="background:${BRAND.bg};border-radius:0 0 14px 14px;padding:22px 32px;text-align:center">
    <div style="font:15px Georgia,serif;color:${BRAND.cream}">${esc(R.name)}</div>
    <div style="font:12px/1.7 Arial,sans-serif;color:${BRAND.dim}">${esc(R.address)}<br>
      <a href="tel:${R.phone}" style="color:${BRAND.gold2};text-decoration:none">${esc(R.phone.replace('+1', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2-$3'))}</a> ·
      <a href="${SITE}" style="color:${BRAND.gold2};text-decoration:none">kawtar.ca</a></div>
  </td></tr>
</table>
<p style="margin:14px 0 0;font:11px Arial,sans-serif;color:#8d8272">${en ? 'Transactional message about your order on kawtar.ca.' : 'Message transactionnel concernant votre commande sur kawtar.ca.'}</p>
</td></tr></table></body></html>`;
}

function textVersion(o, c) {
  const en = o.lang === 'en', m = en ? moneyEn : money;
  const lines = (o.cart_lines || []).map(l => `  ${l.qty}x ${en ? l.en : l.fr}${l.note ? ' — ' + l.note : ''}`).join('\n');
  return [c.title, '', c.lead.replace(/<[^>]+>/g, ''), c.info || '', c.cta ? `${c.cta.label}: ${c.cta.url}` : '', '',
    `${en ? 'Order' : 'Commande'} ${o.order_no}`, lines, `${en ? 'Total paid' : 'Total payé'}: ${m(o.amount_cents)}`, '',
    MENU.restaurant.name, MENU.restaurant.address, MENU.restaurant.phone].filter(s => s != null).join('\n');
}

function renderCustomerEmail(o, event, extra) {
  const c = copy(o, event, extra);
  if (!c) return null;
  return { subject: c.subject, html: layout(o, c, { recap: event !== 'order_dispatched' && event !== 'order_ready' }), text: textVersion(o, c) };
}

/* ---------------- restaurant alerts ---------------- */
function renderRestaurantEmail(o, event, extra = {}) {
  const R = MENU.restaurant;
  const rows = (o.cart_lines || []).map(l => `${l.qty}× ${l.fr}${l.note ? ' — ' + l.note : ''}`).join('\n');
  const addr = o.address ? `\nAdresse : ${addressLine(o)}${o.dropoff_notes ? ' (' + o.dropoff_notes + ')' : ''}` : '';
  const head = `${o.mode === 'delivery' ? 'LIVRAISON' : 'RAMASSAGE'} — ${o.order_no} — ${money(o.amount_cents)}\n${o.customer.name} · ${o.customer.phone} · ${o.customer.email}${addr}\n\n${rows}\n${o.notes ? '\nNote client : ' + o.notes : ''}`;
  const kitchen = `\n\nÉcran cuisine : ${SITE}/cuisine.html`;
  if (event === 'order_paid') return { subject: `🔔 Nouvelle commande ${o.order_no} · ${o.mode === 'delivery' ? 'Livraison' : 'Ramassage'} · ${money(o.amount_cents)}`,
    text: `Nouvelle commande payée.\n\n${head}\n\nAcceptez-la sur l’écran cuisine pour lancer la préparation${o.mode === 'delivery' ? ' et réserver le livreur Uber' : ''}.${kitchen}` };
  if (event === 'delivery_problem') return { subject: `⚠️ Problème de livraison — commande ${o.order_no}`,
    text: `Uber signale un problème : ${extra.detail || 'inconnu'}\n\n${head}\n\nAppelez le client (${o.customer.phone}) et, au besoin, réessayez la réservation du livreur ou annulez/remboursez depuis l’écran cuisine.${kitchen}` };
  if (event === 'order_cancelled') return { subject: `Commande ${o.order_no} annulée — remboursée`,
    text: `La commande a été annulée${extra.reason ? ' (' + extra.reason + ')' : ''} et remboursée intégralement (${money(o.amount_cents)}).\n\n${head}` };
  return null;
}

/* ---------------- transport ---------------- */
let cachedTransport = null;
function smtpReady() { return ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].every(k => process.env[k]); }
function transport() {
  if (cachedTransport) return cachedTransport;
  const nodemailer = require('nodemailer');
  if (process.env.EMAIL_DRY_RUN) return (cachedTransport = nodemailer.createTransport({ jsonTransport: true }));
  const port = +process.env.SMTP_PORT || 587;
  return (cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
  }));
}
function from() { return process.env.EMAIL_FROM || `"${MENU.restaurant.name}" <${process.env.SMTP_USER}>`; }

async function sendCustomerEmail(o, event, extra) {
  const to = o.customer && o.customer.email;
  if (!to) return false;
  if (!smtpReady() && !process.env.EMAIL_DRY_RUN) { console.warn('email: SMTP not configured — customer email skipped', event, o.order_no); return false; }
  const msg = renderCustomerEmail(o, event, extra);
  if (!msg) return false;
  try {
    const info = await transport().sendMail({ from: from(), to, replyTo: process.env.ORDER_EMAIL_TO || undefined, subject: msg.subject, html: msg.html, text: msg.text,
      headers: { 'X-Kawtar-Order': o.order_no, 'X-Kawtar-Event': event } });
    console.log('email: customer', event, o.order_no, '→', to, info.messageId || 'sent');
    return true;
  } catch (e) { console.error('email: customer send failed', event, o.order_no, e.message); return false; }
}

async function sendRestaurantEmail(o, event, extra) {
  const to = process.env.ORDER_EMAIL_TO;
  if (!to) return false;
  if (!smtpReady() && !process.env.EMAIL_DRY_RUN) { console.warn('email: SMTP not configured — restaurant email skipped', event); return false; }
  const msg = renderRestaurantEmail(o, event, extra);
  if (!msg) return false;
  try {
    await transport().sendMail({ from: from(), to, replyTo: o.customer && o.customer.email || undefined, subject: msg.subject, text: msg.text });
    console.log('email: restaurant', event, o.order_no, '→', to);
    return true;
  } catch (e) { console.error('email: restaurant send failed', event, e.message); return false; }
}

module.exports = { renderCustomerEmail, renderRestaurantEmail, sendCustomerEmail, sendRestaurantEmail, smtpReady };
