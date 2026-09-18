/* Kawtar — écran cuisine. Polls /api/order/list, chimes on new orders until
   acknowledged, drives accept (→ Uber for delivery) / ready / complete / cancel. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var money = function (c) { return (c / 100).toFixed(2).replace('.', ',') + ' $'; };

  /* ---------- PIN gate ---------- */
  var pin = null; try { pin = sessionStorage.getItem('kawtarKitchenPin'); } catch (e) {}
  var gate = $('[data-gate]');
  function unlock(p) { pin = p; try { sessionStorage.setItem('kawtarKitchenPin', p); } catch (e) {} gate.style.display = 'none'; start(); }
  if (pin) unlock(pin);
  $('[data-gate-form]').addEventListener('submit', function (e) {
    e.preventDefault(); var p = $('[data-pin]').value.trim(); if (!p) return;
    api('/api/order/list?scope=open', null, p).then(function () { $('[data-gate-err]').hidden = true; unlock(p); })
      .catch(function () { $('[data-gate-err]').hidden = false; $('[data-pin]').value = ''; });
  });
  $('[data-lock]').addEventListener('click', function () { try { sessionStorage.removeItem('kawtarKitchenPin'); } catch (e) {} location.reload(); });

  function api(path, body, p) {
    return fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Kitchen-Pin': p || pin }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.message || j.error || r.status); e.body = j; throw e; } return j; }); });
  }

  /* ---------- sound (repeats until every new order is acknowledged) ---------- */
  var soundOn = true, ac = null, seen = {}, unacked = 0, chimeTimer = null;
  $('[data-sound]').addEventListener('click', function () { soundOn = !soundOn; this.classList.toggle('is-on', soundOn); if (soundOn) chime(); });
  function chime() {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      [0, .18, .36].forEach(function (t, i) {
        var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = [880, 1174, 1568][i];
        g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + .5);
        o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .55);
      });
    } catch (e) {}
  }
  function scheduleChime() { clearInterval(chimeTimer); if (unacked > 0) { chime(); chimeTimer = setInterval(chime, 12000); } }
  document.addEventListener('pointerdown', function () { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume && ac.resume(); } catch (e) {} }, { once: true });

  /* ---------- polling ---------- */
  var tab = 'open', orders = [], timer = null, prepPick = {};
  $$('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); $$('[data-tab]').forEach(function (x) { x.classList.toggle('is-on', x === b); }); load(); }); });
  function start() { load(); clearInterval(timer); timer = setInterval(load, 8000); }
  function load() {
    api('/api/order/list?scope=' + tab).then(function (j) {
      orders = j.orders; $('[data-st]').textContent = 'en direct · ' + new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); $('[data-st]').className = 'kbar__st live';
      var fresh = orders.filter(function (o) { return o.status === 'new' && !seen[o.id]; });
      orders.forEach(function (o) { if (o.status !== 'new') seen[o.id] = true; });
      unacked = orders.filter(function (o) { return o.status === 'new'; }).length;
      if (fresh.length) { fresh.forEach(function (o) { seen[o.id] = 'ringing'; }); }
      scheduleChime(); render();
    }).catch(function (e) { $('[data-st]').textContent = 'hors ligne — ' + e.message; $('[data-st]').className = 'kbar__st off'; if (e.body && e.body.error === 'unauthorized') { try { sessionStorage.removeItem('kawtarKitchenPin'); } catch (x) {} location.reload(); } });
  }

  /* ---------- render ---------- */
  function ago(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'à l’instant' : m + ' min'; }
  function card(o) {
    var d = document.createElement('article'); d.className = 'card' + (o.status === 'new' ? ' is-new' : '');
    var age = Math.round((Date.now() - o.created) / 60000);
    var items = (o.cart_lines || []).map(function (l) { return '<li><b>' + l.qty + '×</b><span>' + l.fr + (l.note ? '<small>' + l.note.replace(/</g, '&lt;') + '</small>' : '') + '</span></li>'; }).join('') || '<li>' + o.cart + '</li>';
    var addr = o.address ? [o.address.street, o.address.city, o.address.postal].filter(Boolean).join(', ') : '';
    var uber = o.uber ? '<p class="uber">🛵 Uber : <b>' + (o.uber.status || 'réservé') + '</b>' + (o.uber.tracking_url ? ' · <a href="' + o.uber.tracking_url + '" target="_blank" rel="noopener">suivi</a>' : '') + '</p>' : '';
    var ready = o.ready_at ? ' · prête ' + new Date(o.ready_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
    d.innerHTML = '<div class="card__top"><span class="card__no">' + o.order_no + '</span><span class="card__mode ' + o.mode + '">' + (o.mode === 'delivery' ? 'Livraison' : 'Ramassage') + '</span></div>'
      + '<div class="card__meta"><span>' + new Date(o.created).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) + ready + '</span><span class="card__age' + (o.status === 'new' && age >= 5 ? ' late' : '') + '">' + ago(o.created) + '</span></div>'
      + '<ul class="items">' + items + '</ul>'
      + (o.notes ? '<p class="note"><b>Note :</b> ' + o.notes.replace(/</g, '&lt;') + '</p>' : '')
      + '<p class="cust"><b>' + o.customer.name + '</b> · <a href="tel:' + o.customer.phone + '">' + o.customer.phone + '</a>' + (addr ? '<br>📍 ' + addr : '') + (o.dropoff_notes ? '<br><i>' + o.dropoff_notes.replace(/</g, '&lt;') + '</i>' : '') + '</p>'
      + uber
      + '<p class="tot"><span>Total payé</span><span>' + money(o.amount_cents) + '</span></p>';
    var acts = document.createElement('div'); acts.className = 'acts';
    if (o.status === 'new') {
      var prep = document.createElement('div'); prep.className = 'prep'; prepPick[o.id] = prepPick[o.id] || 25;
      [15, 25, 40, 60].forEach(function (m) { var b = document.createElement('button'); b.type = 'button'; b.textContent = m + ' min'; b.className = prepPick[o.id] === m ? 'is-on' : '';
        b.addEventListener('click', function () { prepPick[o.id] = m; $$('button', prep).forEach(function (x) { x.classList.toggle('is-on', x === b); }); }); prep.appendChild(b); });
      d.appendChild(prep);
      acts.appendChild(btn('✓ Accepter' + (o.mode === 'delivery' ? ' + réserver le livreur' : ''), 'go', function (b) { act(o, 'accept', { prep_minutes: prepPick[o.id] }, b); }));
      acts.appendChild(btn('Refuser', 'warn', function (b) { var why = prompt('Raison (le client sera remboursé) :', 'Rupture de stock'); if (why != null) act(o, 'cancel', { reason: why }, b); }));
    } else if (o.status === 'accepted') {
      acts.appendChild(btn(o.mode === 'delivery' ? '✓ Prête pour le livreur' : '✓ Prête', 'go', function (b) { act(o, 'ready', {}, b); }));
      acts.appendChild(btn('Annuler', 'warn', function (b) { var why = prompt('Raison (remboursement complet) :', ''); if (why != null) act(o, 'cancel', { reason: why }, b); }));
    } else if (o.status === 'ready' || o.status === 'dispatched') {
      if (o.mode === 'pickup') acts.appendChild(btn('✓ Remise au client', 'go', function (b) { act(o, 'complete', {}, b); }));
      else acts.appendChild(btn('Marquer livrée', '', function (b) { act(o, 'complete', {}, b); }));
    }
    if (acts.children.length) d.appendChild(acts);
    return d;
  }
  function btn(label, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.addEventListener('click', function () { fn(b); }); return b; }
  function act(o, action, extra, b) {
    b.disabled = true; b.textContent = '…';
    api('/api/order/update', Object.assign({ id: o.id, action: action }, extra)).then(function () { seen[o.id] = true; load(); })
      .catch(function (e) { alert((e.body && e.body.error === 'uber_booking_failed') ? 'Commande acceptée mais Uber n’a pas pu réserver le livreur :\n' + e.message + '\n\nAppelez le client ou réessayez.' : 'Erreur : ' + e.message); load(); });
  }
  function render() {
    var cols = { 'new': $('[data-col-new]'), prep: $('[data-col-prep]'), ready: $('[data-col-ready]') };
    Object.keys(cols).forEach(function (k) { cols[k].innerHTML = ''; });
    var n = { 'new': 0, prep: 0, ready: 0 };
    orders.forEach(function (o) {
      var k = o.status === 'new' ? 'new' : o.status === 'accepted' ? 'prep' : (['ready', 'dispatched', 'delivered', 'completed'].indexOf(o.status) >= 0 ? 'ready' : null);
      if (!k) return; if (tab === 'open' && (o.status === 'delivered' || o.status === 'completed')) return;
      n[k]++; cols[k].appendChild(card(o));
    });
    Object.keys(cols).forEach(function (k) { if (!n[k]) cols[k].innerHTML = '<p class="empty">—</p>'; });
    $('[data-n-new]').textContent = n['new']; $('[data-n-prep]').textContent = n.prep; $('[data-n-ready]').textContent = n.ready;
    document.title = (n['new'] ? '(' + n['new'] + ') ' : '') + 'Cuisine — Kawtar';
  }
})();
