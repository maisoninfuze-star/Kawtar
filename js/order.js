/* ==========================================================================
   KAWTAR — commander en ligne : menu, panier, caisse
   The browser only tracks item ids + quantities; the server reprices everything.
   ========================================================================== */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  /* ---------- i18n (same mechanism as the site) ---------- */
  var lang = 'fr';
  try { lang = localStorage.getItem('kawtarLang') === 'en' ? 'en' : 'fr'; } catch (e) {}
  var i18nEls = [];
  function collectI18n() {
    i18nEls = $$('[data-en]').map(function (el) { if (el._fr == null) el._fr = el.innerHTML; return el; });
    $$('[data-en-ph]').forEach(function (el) { if (el._frph == null) el._frph = el.getAttribute('placeholder') || ''; });
  }
  function applyLang() {
    collectI18n();
    var en = lang === 'en';
    i18nEls.forEach(function (el) { el.innerHTML = en ? (el.getAttribute('data-en') || el._fr) : el._fr; });
    $$('[data-en-ph]').forEach(function (el) { el.setAttribute('placeholder', en ? (el.getAttribute('data-en-ph') || el._frph) : el._frph); });
    document.documentElement.setAttribute('lang', lang);
    $$('[data-lang-opt]').forEach(function (o) { o.classList.toggle('is-on', o.getAttribute('data-lang-opt') === lang); });
    try { localStorage.setItem('kawtarLang', lang); } catch (e) {}
    if (MENU) { renderMenu(); renderCart(); }
  }
  $$('[data-lang-toggle]').forEach(function (b) { b.addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); }); });
  var T = function (fr, en) { return lang === 'en' ? en : fr; };
  var money = function (c) { return lang === 'en' ? '$' + (c / 100).toFixed(2) : (c / 100).toFixed(2).replace('.', ',') + ' $'; };

  /* ---------- state ---------- */
  var MENU = null, CFG = null, ITEMS = {};
  var cart = [];       // [{key,id,variant,qty,note}]
  var mode = 'pickup', tip = 0, zoneOK = null, quoting = null;
  try { var saved = JSON.parse(localStorage.getItem('kawtarCart') || '{}'); cart = saved.cart || []; mode = saved.mode === 'delivery' ? 'delivery' : 'pickup'; } catch (e) {}
  function persist() { try { localStorage.setItem('kawtarCart', JSON.stringify({ cart: cart, mode: mode })); } catch (e) {} }

  /* ---------- load menu ---------- */
  fetch('./data/menu.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (m) {
    MENU = m; CFG = m.ordering;
    m.categories.forEach(function (c) { c.items.forEach(function (it) { it._cat = c; ITEMS[it.id] = it; }); });
    var blurb = $('[data-delivery-blurb]');
    if (blurb) { blurb._fr = money(CFG.delivery_fee_cents) + ' · gratuite dès ' + money(CFG.free_delivery_over_cents);
      blurb.setAttribute('data-en', '$' + (CFG.delivery_fee_cents/100).toFixed(2) + ' · free over $' + (CFG.free_delivery_over_cents/100).toFixed(0)); }
    setMode(mode, true); applyLang(); buildTips();
  }).catch(function () { $('[data-menu]').innerHTML = '<p class="menu__loading">Menu indisponible — <a href="tel:+15148910831">514 891-0831</a></p>'; });

  function couscousToday() {
    var c = MENU.categories.filter(function (x) { return x.id === 'couscous'; })[0];
    if (!c || !c.available_days) return true;
    var day = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })).getDay();
    return c.available_days.indexOf(day) >= 0;
  }
  function inCart(id) { return cart.filter(function (l) { return l.id === id; }).reduce(function (s, l) { return s + l.qty; }, 0); }

  /* ---------- menu render ---------- */
  function renderMenu() {
    var tabs = $('[data-cattabs]'), wrap = $('[data-menu]');
    tabs.innerHTML = ''; wrap.innerHTML = '';
    MENU.categories.forEach(function (c, i) {
      var a = document.createElement('a'); a.href = '#cat-' + c.id; a.textContent = lang === 'en' ? c.en : c.fr; if (i === 0) a.className = 'is-on'; tabs.appendChild(a);
      var off = c.id === 'couscous' && !couscousToday();
      var sec = document.createElement('section'); sec.className = 'mcat'; sec.id = 'cat-' + c.id;
      var note = c.note ? '<span class="mcat__note">' + (lang === 'en' ? (c.note_en || c.note) : c.note) + '</span>' : '';
      sec.innerHTML = '<div class="mcat__h"><h2>' + (lang === 'en' ? c.en : c.fr) + '</h2>' + note + '</div>'
        + (off ? '<p class="mcat__closed">' + T('Le couscous est servi du vendredi au dimanche.', 'Couscous is served Friday to Sunday.') + '</p>' : '')
        + '<div class="mgrid"></div>';
      var grid = $('.mgrid', sec);
      c.items.forEach(function (it) {
        var el = document.createElement('article'); el.className = 'mitem' + (off ? ' is-off' : '');
        var price = it.variants ? T('dès ', 'from ') + money(it.variants[0].price_cents) : money(it.price_cents);
        var tag = it.variants ? '<small>' + (it.variants.length === 2 && it.variants[1].id === 'combo' ? T('combo offert', 'combo available') : T(it.variants.length + ' formats', it.variants.length + ' sizes')) + '</small>' : '';
        el.innerHTML = '<div><h3 class="mitem__name">' + (lang === 'en' ? it.en : it.fr) + '</h3>'
          + (it.desc_fr ? '<p class="mitem__desc">' + (lang === 'en' ? it.desc_en : it.desc_fr) + '</p>' : '')
          + '<p class="mitem__price">' + price + tag + '</p></div>'
          + '<button class="mitem__add" type="button" aria-label="' + T('Ajouter', 'Add') + '" data-in="' + inCart(it.id) + '">+</button>';
        $('.mitem__add', el).addEventListener('click', function () { openPick(it); });
        grid.appendChild(el);
      });
      wrap.appendChild(sec);
    });
    // active tab on scroll
    var secs = $$('.mcat'), links = $$('a', tabs);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { links.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('href') === '#' + e.target.id); }); } }); }, { rootMargin: '-140px 0px -60% 0px' });
      secs.forEach(function (s) { io.observe(s); });
    }
  }
  function refreshBadges() { $$('.mitem').forEach(function (el) { var b = $('.mitem__add', el); var name = $('.mitem__name', el).textContent;
    var it = Object.keys(ITEMS).map(function (k) { return ITEMS[k]; }).filter(function (x) { return x.fr === name || x.en === name; })[0]; if (it) b.setAttribute('data-in', inCart(it.id)); }); }

  /* ---------- picker (variant + note + qty) ---------- */
  var pick = $('#pickModal'), pk = { item: null, variant: null, qty: 1 };
  function openPick(it) {
    pk = { item: it, variant: it.variants ? it.variants[0].id : null, qty: 1 };
    $('[data-pick-title]').textContent = lang === 'en' ? it.en : it.fr;
    $('[data-pick-desc]').textContent = lang === 'en' ? it.desc_en : it.desc_fr;
    var v = $('[data-pick-variants]'); v.innerHTML = '';
    (it.variants || []).forEach(function (va, i) {
      var l = document.createElement('label'); l.className = i === 0 ? 'is-on' : '';
      l.innerHTML = '<input type="radio" name="variant" value="' + va.id + '"' + (i === 0 ? ' checked' : '') + '><span>' + (lang === 'en' ? va.en : va.fr) + '</span><b>' + money(va.price_cents) + '</b>';
      l.addEventListener('click', function () { pk.variant = va.id; $$('label', v).forEach(function (x) { x.classList.toggle('is-on', x === l); }); pickPrice(); });
      v.appendChild(l);
    });
    $('[data-pick-note]').value = ''; $('[data-pick-qty]').textContent = '1'; pickPrice();
    pick.classList.add('is-open'); pick.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
  }
  function unitPrice(it, variant) { if (!it.variants) return it.price_cents; var va = it.variants.filter(function (x) { return x.id === variant; })[0] || it.variants[0]; return va.price_cents; }
  function pickPrice() { $('[data-pick-price]').textContent = money(unitPrice(pk.item, pk.variant) * pk.qty); }
  function closePick() { pick.classList.remove('is-open'); pick.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); }
  $$('[data-pick-close]').forEach(function (b) { b.addEventListener('click', closePick); });
  $('[data-pick-inc]').addEventListener('click', function () { pk.qty = Math.min(20, pk.qty + 1); $('[data-pick-qty]').textContent = pk.qty; pickPrice(); });
  $('[data-pick-dec]').addEventListener('click', function () { pk.qty = Math.max(1, pk.qty - 1); $('[data-pick-qty]').textContent = pk.qty; pickPrice(); });
  $('[data-pick-add]').addEventListener('click', function () {
    var note = $('[data-pick-note]').value.trim().slice(0, 120);
    var key = pk.item.id + '|' + (pk.variant || '') + '|' + note;
    var ex = cart.filter(function (l) { return l.key === key; })[0];
    if (ex) ex.qty = Math.min(20, ex.qty + pk.qty); else cart.push({ key: key, id: pk.item.id, variant: pk.variant, qty: pk.qty, note: note });
    persist(); renderCart(); refreshBadges(); closePick();
    var cb = $('.cartbtn'); cb.classList.remove('is-bump'); void cb.offsetWidth; cb.classList.add('is-bump');
  });

  /* ---------- mode ---------- */
  function setMode(m, silent) {
    mode = m; persist();
    $$('.modeseg__btn').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
    var df = $('[data-delivery-fields]'); if (df) df.hidden = m !== 'delivery';
    var th = $('[data-tip-h]'); if (th) { th._fr = m === 'delivery' ? 'Pourboire au livreur' : 'Pourboire'; th.setAttribute('data-en', m === 'delivery' ? 'Courier tip' : 'Tip'); th.innerHTML = lang === 'en' ? th.getAttribute('data-en') : th._fr; }
    if (!silent) renderCart();
  }
  $$('.modeseg__btn').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });

  /* ---------- tips ---------- */
  function buildTips() {
    var w = $('[data-tips]'); w.innerHTML = '';
    CFG.tips_cents.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = c ? money(c) : T('Aucun', 'None'); b.className = c === tip ? 'is-on' : '';
      b.addEventListener('click', function () { tip = c; $$('button', w).forEach(function (x) { x.classList.toggle('is-on', x === b); }); renderCart(); });
      w.appendChild(b);
    });
  }

  /* ---------- cart ---------- */
  function totals() {
    var sub = cart.reduce(function (s, l) { return s + unitPrice(ITEMS[l.id], l.variant) * l.qty; }, 0);
    var del = mode === 'delivery' ? (sub >= CFG.free_delivery_over_cents ? 0 : CFG.delivery_fee_cents) : 0;
    var taxable = sub + del, tax = Math.round(taxable * CFG.tax.tps) + Math.round(taxable * CFG.tax.tvq);
    return { sub: sub, del: del, tax: tax, tip: tip, total: sub + del + tax + tip };
  }
  function renderCart() {
    if (!MENU) return;
    var wrap = $('[data-cart-lines]'); wrap.innerHTML = '';
    cart = cart.filter(function (l) { return ITEMS[l.id]; });
    cart.forEach(function (l) {
      var it = ITEMS[l.id], va = it.variants ? it.variants.filter(function (x) { return x.id === l.variant; })[0] : null;
      var row = document.createElement('div'); row.className = 'cline';
      row.innerHTML = '<div><p class="cline__name">' + (lang === 'en' ? it.en : it.fr) + (va ? ' <small>— ' + (lang === 'en' ? va.en : va.fr) + '</small>' : '') + '</p>'
        + (l.note ? '<p class="cline__note">' + l.note.replace(/</g, '&lt;') + '</p>' : '')
        + '<p class="cline__price">' + money(unitPrice(it, l.variant) * l.qty) + '</p></div>'
        + '<div class="qty"><button type="button" aria-label="Moins">−</button><span>' + l.qty + '</span><button type="button" aria-label="Plus">+</button></div>';
      var bs = $$('button', row);
      bs[0].addEventListener('click', function () { l.qty--; if (l.qty <= 0) cart = cart.filter(function (x) { return x !== l; }); persist(); renderCart(); refreshBadges(); });
      bs[1].addEventListener('click', function () { l.qty = Math.min(20, l.qty + 1); persist(); renderCart(); refreshBadges(); });
      wrap.appendChild(row);
    });
    var n = cart.reduce(function (s, l) { return s + l.qty; }, 0), t = totals();
    $('[data-cart-count]').textContent = n; $('[data-cart-total]').textContent = money(t.sub);
    $('[data-cart-empty]').hidden = n > 0; $('[data-oform]').hidden = n === 0; $('[data-cart-foot]').hidden = n === 0;
    $('[data-t-sub]').textContent = money(t.sub); $('[data-t-tax]').textContent = money(t.tax);
    $('[data-t-del-row]').hidden = mode !== 'delivery'; $('[data-t-del]').textContent = t.del ? money(t.del) : T('Gratuite', 'Free');
    $('[data-t-tip-row]').hidden = !t.tip; $('[data-t-tip]').textContent = money(t.tip);
    $('[data-t-total]').textContent = money(t.total); $('[data-pay-total]').textContent = money(t.total);
    var pay = $('[data-pay]'); pay.disabled = t.sub < CFG.min_order_cents;
  }
  var drawer = $('[data-drawer]');
  function openCart() { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); }
  function closeCart() { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); }
  $$('[data-cart-open]').forEach(function (b) { b.addEventListener('click', openCart); });
  $$('[data-cart-close]').forEach(function (b) { b.addEventListener('click', closeCart); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeCart(); closePick(); } });

  /* ---------- delivery zone check (early, before payment) ---------- */
  var zoneEl = $('[data-zone]'), form = $('#orderForm');
  function checkZone() {
    if (mode !== 'delivery') return;
    var a = addr(); if (!a.street || !a.postal) { zoneEl.textContent = ''; zoneOK = null; return; }
    zoneEl.className = 'oform__zone wait'; zoneEl.textContent = T('Vérification de la zone de livraison…', 'Checking delivery zone…'); zoneOK = null;
    var my = quoting = fetch('/api/delivery/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropoff_address: { street_address: [a.street], city: a.city, zip_code: a.postal, state: 'QC', country: 'CA' } }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (my !== quoting) return;
        if (res.ok && res.j.fee_cents != null && res.j.fee_cents <= CFG.max_uber_fee_cents) {
          zoneOK = true; zoneEl.className = 'oform__zone ok';
          zoneEl.textContent = '✓ ' + T('Livraison disponible · environ ', 'Delivery available · about ') + (res.j.duration_minutes || 45) + ' min';
        } else { zoneOK = false; zoneEl.className = 'oform__zone bad';
          zoneEl.textContent = T('Désolé, cette adresse est hors de notre zone de livraison. Essayez le ramassage.', 'Sorry, this address is outside our delivery zone. Try pickup.'); }
      }).catch(function () { if (my === quoting) { zoneOK = null; zoneEl.textContent = ''; } });
  }
  function addr() { return { street: form.street.value.trim(), city: form.city.value.trim() || 'Laval', postal: form.postal.value.trim().toUpperCase(), notes: form.dropoff_notes.value.trim() }; }
  var zt; ['street', 'postal', 'city'].forEach(function (n) { form[n].addEventListener('input', function () { clearTimeout(zt); zt = setTimeout(checkZone, 700); }); });

  /* ---------- pay ---------- */
  var errEl = $('[data-oerr]');
  function fail(msg) { errEl.hidden = false; errEl.innerHTML = msg; $('[data-pay]').disabled = false; $('[data-pay] span').textContent = T('Payer en toute sécurité', 'Pay securely'); }
  var ERR = {
    below_minimum: ['Commande minimum de 15 $ (avant taxes).', 'Minimum order is $15 (before tax).'],
    address_not_serviceable: ['Nous ne trouvons pas cette adresse. Vérifiez la rue et le code postal.', 'We can’t find that address. Check the street and postal code.'],
    outside_delivery_zone: ['Cette adresse est hors de notre zone de livraison. Essayez le ramassage.', 'That address is outside our delivery zone. Try pickup.'],
    couscous_not_today: ['Le couscous est servi du vendredi au dimanche.', 'Couscous is served Friday to Sunday.'],
    missing_address: ['Complétez l’adresse de livraison.', 'Please complete the delivery address.'],
    missing_customer: ['Indiquez votre nom et votre téléphone.', 'Please enter your name and phone.'],
    bad_email: ['Vérifiez votre adresse courriel.', 'Please check your email address.'],
  };
  $('[data-pay]').addEventListener('click', function () {
    errEl.hidden = true;
    var ok = true;
    ['name', 'phone', 'email'].forEach(function (n) { var f = form[n]; var bad = !f.value.trim() || (n === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.value.trim())); f.classList.toggle('invalid', bad); if (bad) ok = false; });
    if (mode === 'delivery') ['street', 'postal'].forEach(function (n) { var bad = !form[n].value.trim(); form[n].classList.toggle('invalid', bad); if (bad) ok = false; });
    if (!ok) return fail(T('Complétez les champs en rouge.', 'Please complete the highlighted fields.'));
    if (mode === 'delivery' && zoneOK === false) return fail(ERR.outside_delivery_zone[lang === 'en' ? 1 : 0]);
    var btn = $('[data-pay]'); btn.disabled = true; $('span', btn).textContent = T('Redirection vers le paiement…', 'Redirecting to payment…');
    var body = { mode: mode, lang: lang, tip_cents: tip, notes: form.notes.value.trim(),
      customer: { name: form.name.value.trim(), phone: form.phone.value.trim(), email: form.email.value.trim() },
      cart: cart.map(function (l) { return { id: l.id, qty: l.qty, variant: l.variant, note: l.note }; }) };
    if (mode === 'delivery') body.address = addr();
    fetch('/api/order/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.url) { var m = ERR[res.j.error]; return fail(m ? m[lang === 'en' ? 1 : 0] : T('Impossible de démarrer le paiement. Appelez-nous au <a href="tel:+15148910831">514 891-0831</a>.', 'We couldn’t start the payment. Call us at <a href="tel:+15148910831">514 891-0831</a>.')); }
        window.location.href = res.j.url;
      }).catch(function () { fail(T('Problème de connexion. Réessayez.', 'Connection problem. Please try again.')); });
  });

  if (/cancelled=1/.test(location.search)) { setTimeout(openCart, 300); }
})();
