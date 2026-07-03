/* ==========================================================================
   KAWTAR — interaction layer
   - Desktop (fine pointer, ≥1024px, motion ok): cinematic horizontal scroll
   - Otherwise: graceful vertical layout with scroll-reveal
   ========================================================================== */
(function () {
  'use strict';

  var docEl = document.documentElement;
  var nav = document.querySelector('[data-nav]');
  var track = document.querySelector('[data-track]');
  var spacer = document.querySelector('[data-spacer]');
  var progress = document.querySelector('[data-progress]');
  var cue = document.querySelector('[data-cue]');
  var dotsWrap = document.querySelector('[data-dots]');
  var panels = [].slice.call(document.querySelectorAll('[data-panel]'));
  var anims = [].slice.call(document.querySelectorAll('[data-anim]'));
  var navLinkEls = [].slice.call(document.querySelectorAll('.nav__link'));

  /* ---------- scroll-scrubbed videos (hero tajine + story tea-pour) ----------
     mode "exit"  — closed at rest, scrubs open as the panel scrolls away (hero)
     mode "cross" — scrubs across enter → centre → exit (story)                */
  var scrubVids = [].slice.call(document.querySelectorAll('[data-scrub]'));
  scrubVids.forEach(function (v) {
    v._pi = panels.indexOf(v.closest('[data-panel]'));
    v._mode = v.getAttribute('data-scrub-mode') || 'cross';
    v._ready = false; v._last = -1;
    var prime = function () {
      v._ready = true;
      var p = v.play();                    // prime decode so seeks are responsive
      if (p && p.then) p.then(function () { v.pause(); }).catch(function () {});
    };
    if (v.readyState >= 1) prime();
    else v.addEventListener('loadedmetadata', prime, { once: true });
  });
  function setScrub(v, progress) {
    if (!v._ready) return;
    var dur = v.duration;
    if (!dur || !isFinite(dur)) return;
    progress = Math.max(0, Math.min(1, progress));
    var t = progress * (dur - 0.05);
    if (Math.abs(t - v._last) < 0.03) return;        // skip micro-seeks
    v._last = t;
    try { v.currentTime = t; } catch (e) {}
  }
  var EXIT_SPAN = 0.4;   // hero lid finishes opening within the first 40% of scroll
  function scrubHorizontal(ns) {
    for (var i = 0; i < scrubVids.length; i++) {
      var v = scrubVids[i];
      if (v._pi < 0) continue;
      var n = ns[v._pi] || 0;
      setScrub(v, v._mode === 'exit' ? (-n / EXIT_SPAN) : (1 - n) / 2);
    }
  }
  function scrubVertical() {
    var vh = window.innerHeight;
    for (var i = 0; i < scrubVids.length; i++) {
      var v = scrubVids[i];
      if (!v._ready) continue;
      var r = v.getBoundingClientRect();
      setScrub(v, v._mode === 'exit' ? (-r.top / ((r.height || vh) * EXIT_SPAN)) : (vh - r.top) / (vh + r.height));
    }
  }

  /* ---------- reels (autoplay on view · tap to unmute) ---------- */
  var reels = [].slice.call(document.querySelectorAll('[data-reel]'));
  if (reels.length) {
    function reelPlay(v) {
      if (!v._want) return;
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        // not buffered / blocked yet — retry once the video can play
        v.addEventListener('canplay', function once() {
          v.removeEventListener('canplay', once);
          if (v._want) { var q = v.play(); if (q && q.catch) q.catch(function () {}); }
        }, { once: true });
      });
    }
    if ('IntersectionObserver' in window) {
      var reelIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var v = en.target;
          if (en.isIntersecting) { v._want = true; reelPlay(v); }
          else { v._want = false; v.pause(); }
        });
      }, { threshold: 0.35 });
      reels.forEach(function (v) { reelIO.observe(v); });
    } else {
      reels.forEach(function (v) { v._want = true; reelPlay(v); });
    }
    // some browsers gate programmatic muted autoplay until first interaction —
    // the user always scrolls before reaching the reels, so unlock on it.
    var reelUnlocked = false;
    function reelUnlock() {
      if (reelUnlocked) return; reelUnlocked = true;
      reels.forEach(function (v) { if (v._want) reelPlay(v); });
    }
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, reelUnlock, { once: true, passive: true });
    });

    [].forEach.call(document.querySelectorAll('[data-reel-card]'), function (card) {
      card.addEventListener('click', function () {
        var v = card.querySelector('[data-reel]');
        var willUnmute = v.muted;
        reels.forEach(function (o) { o.muted = true; if (o.parentNode) o.parentNode.classList.remove('is-on'); });
        if (willUnmute) {
          v.muted = false;
          card.classList.add('is-on');
          var p = v.play(); if (p && p.catch) p.catch(function () {});
        }
      });
    });
  }

  /* ---------- interactive tajine (Apple-style pinned reveal) ---------- */
  var tajineSection = document.getElementById('p-tajine');
  var tajinePanelIndex = tajineSection ? panels.indexOf(tajineSection) : -1;
  var tajineStage = document.querySelector('[data-tajine-stage]');
  var tajineDishes = [].slice.call(document.querySelectorAll('.tajine-dish'));
  var tajineLid = document.querySelector('[data-tajine-lid]');
  var tajineVid = document.querySelector('[data-tajine-vid]');
  var tajineNameEl = document.querySelector('[data-tajine-name]');
  var tajineSubEl = document.querySelector('[data-tajine-sub]');
  var tajineStepEls = [].slice.call(document.querySelectorAll('[data-tajine-steps] [data-step]'));
  var tajineActive = -1, tajineVidReady = false, tajineVidDur = 0;
  var TAJINE_C = [0.18, 0.45, 0.72, 0.99], TAJINE_W = 0.30;
  var TAJINE_DATA = [
    { fr: ['Tajine Poulet', 'Citron confit, olives & safran'],       en: ['Chicken Tajine', 'Preserved lemon, olives & saffron'] },
    { fr: ['Tajine Bœuf', 'Oignons confits, pruneaux & sésame'],     en: ['Beef Tajine', 'Caramelised onion, prunes & sesame'] },
    { fr: ['Tajine Légumes', 'Sept légumes, pois chiches & herbes'], en: ['Vegetable Tajine', 'Seven vegetables, chickpeas & herbs'] },
    { fr: ['Tajine Fruits de Mer', 'Crevettes, moules & chermoula'], en: ['Seafood Tajine', 'Shrimp, mussels & chermoula'] }
  ];

  if (tajineVid) {
    var tjPrime = function () {
      tajineVidReady = true; tajineVidDur = tajineVid.duration || 0;
      if (tajineSection) tajineSection.classList.add('tajine-has-vid');
      var p = tajineVid.play(); if (p && p.then) p.then(function () { tajineVid.pause(); }).catch(function () {});
    };
    if (tajineVid.readyState >= 1) tjPrime();
    else tajineVid.addEventListener('loadedmetadata', tjPrime, { once: true });
  }

  function setTajineName(i) {
    if (!tajineNameEl) return;
    var pair = (TAJINE_DATA[i] || TAJINE_DATA[0])[currentLang === 'en' ? 'en' : 'fr'];
    tajineNameEl.classList.add('is-swap'); tajineSubEl.classList.add('is-swap');
    setTimeout(function () {
      tajineNameEl.textContent = pair[0]; tajineSubEl.textContent = pair[1];
      tajineNameEl.classList.remove('is-swap'); tajineSubEl.classList.remove('is-swap');
    }, 200);
    tajineStepEls.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
  }

  function updateTajine(p) {
    if (!tajineSection) return;
    p = Math.max(0, Math.min(1, p));
    var open = Math.max(0, Math.min(1, p / 0.16));        // 0 = lid closed → 1 = open
    if (tajineVidReady) {
      if (tajineVidDur) { try { tajineVid.currentTime = open * (tajineVidDur - 0.05); } catch (e) {} }
      tajineVid.style.opacity = Math.max(0, Math.min(1, (0.2 - p) / 0.06)).toFixed(3);
    } else if (tajineLid) {
      tajineLid.style.opacity = (1 - open).toFixed(3);
      tajineLid.style.transform = 'translateY(' + (-open * 12).toFixed(1) + '%) scale(' + (1 + open * 0.05).toFixed(3) + ')';
    }
    var best = 0, bestd = 9;
    for (var i = 0; i < tajineDishes.length; i++) {
      var o = Math.max(0, Math.min(1, 1 - Math.abs(p - TAJINE_C[i]) / TAJINE_W));
      tajineDishes[i].style.opacity = o.toFixed(3);
      var d = Math.abs(p - TAJINE_C[i]); if (d < bestd) { bestd = d; best = i; }
    }
    if (best !== tajineActive) { tajineActive = best; setTajineName(best); }
  }

  var mqDesktop = window.matchMedia('(min-width:1024px) and (pointer:fine)');
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var active = null;          // current mode controller cleanup fn
  var currentPanel = -1;

  /* ---------- helpers ---------- */
  function setMode(horizontal) {
    docEl.classList.toggle('mode-horizontal', horizontal);
    docEl.classList.toggle('mode-vertical', !horizontal);
  }

  function setActivePanel(i) {
    if (i === currentPanel) return;
    currentPanel = i;
    var panel = panels[i];
    if (!panel) return;
    var id = panel.id;
    navLinkEls.forEach(function (a) {
      a.classList.toggle('is-active', !!id && a.getAttribute('data-link') === id);
    });
    if (dotsWrap) {
      [].forEach.call(dotsWrap.children, function (d, di) {
        d.classList.toggle('is-active', di === i);
      });
    }
  }

  function buildDots(onJump) {
    if (!dotsWrap) return;
    dotsWrap.innerHTML = '';
    panels.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', p.getAttribute('data-label') || ('Section ' + (i + 1)));
      b.addEventListener('click', function () { onJump(i); });
      dotsWrap.appendChild(b);
    });
  }

  /* ======================================================================
     HORIZONTAL ENGINE
     ====================================================================== */
  function horizontalMode() {
    anims.forEach(function (el) {
      var p = el.closest('[data-panel]');
      el._pi = panels.indexOf(p);
      el._depth = parseFloat(el.getAttribute('data-depth'));
      if (isNaN(el._depth)) el._depth = 1;
    });

    var N = panels.length;
    var maxScroll = 0;

    function layout() {
      var w = window.innerWidth;
      var total = 0;
      for (var i = 0; i < panels.length; i++) total += panels[i].offsetWidth;
      track.style.width = total + 'px';
      maxScroll = Math.max(0, total - w);
      spacer.style.height = (maxScroll + window.innerHeight) + 'px';
    }
    layout();

    var lerp = 0.085;
    var current = window.scrollY || 0;
    var targetY = current;
    var lastSet = current;
    var raf = 0;

    function clamp() { targetY = Math.max(0, Math.min(targetY, maxScroll)); }

    function onWheel(e) {
      if (e.ctrlKey) return;
      if (document.body.classList.contains('modal-open')) return;
      var d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= window.innerWidth;
      targetY += d; clamp(); e.preventDefault();
    }

    function onKey(e) {
      var t = e.target;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '')) return;
      if (document.body.classList.contains('modal-open')) return;
      var vw = window.innerWidth, d = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') d = vw * 0.92;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') d = -vw * 0.92;
      else if (e.key === 'Home') { targetY = 0; clamp(); e.preventDefault(); return; }
      else if (e.key === 'End') { targetY = maxScroll; clamp(); e.preventDefault(); return; }
      if (d) { targetY += d; clamp(); e.preventDefault(); }
    }

    function jumpTo(i) {
      var el = panels[i];
      if (el) { targetY = el.offsetLeft; clamp(); }
    }

    function onAnchor(e) {
      var id = e.currentTarget.getAttribute('data-link');
      var el = document.getElementById(id);
      if (el) { e.preventDefault(); targetY = el.offsetLeft; clamp(); }
    }
    var anchors = [].slice.call(document.querySelectorAll('a[data-link]'));
    anchors.forEach(function (a) { a.addEventListener('click', onAnchor); });

    buildDots(jumpTo);

    function effects() {
      var W = window.innerWidth;
      track.style.transform = 'translate3d(' + (-current).toFixed(2) + 'px,0,0)';
      if (progress) progress.style.width = (maxScroll > 0 ? (current / maxScroll) * 100 : 0) + '%';
      if (cue) cue.style.opacity = current > 60 ? '0' : '1';
      nav.classList.toggle('is-scrolled', current > 40);

      var ns = panels.map(function (p) {
        return (p.offsetLeft + p.offsetWidth / 2 - current - W / 2) / W;
      });
      for (var k = 0; k < anims.length; k++) {
        var el = anims[k];
        var n = ns[el._pi] || 0;
        var an = Math.abs(n);
        if (el._depth < 0) {
          // background layer — horizontal parallax + gentle fade (no pop/scale)
          var dxb = n * 150 * el._depth;
          el.style.transform = 'translate3d(' + dxb.toFixed(1) + 'px,0,0)';
          el.style.opacity = Math.max(0, Math.min(1, 1.35 - an * 1.0)).toFixed(3);
        } else {
          // foreground — content "pops up" into place as the panel arrives
          var enter = Math.max(0, Math.min(1, 1.18 - an * 1.7));
          var dx = n * 90 * el._depth;
          var dy = (1 - enter) * 46;
          var sc = 0.94 + enter * 0.06;
          el.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0) scale(' + sc.toFixed(3) + ')';
          el.style.opacity = enter.toFixed(3);
        }
      }
      scrubHorizontal(ns);
      // pin the tajine stage while its (extra-wide) panel traverses, drive the reveal
      if (tajineStage && tajinePanelIndex >= 0) {
        var tp = panels[tajinePanelIndex];
        var travel = tp.offsetWidth - W;
        var local = Math.max(0, Math.min(current - tp.offsetLeft, travel));
        tajineStage.style.transform = 'translate3d(' + local.toFixed(1) + 'px,0,0)';
        updateTajine(travel > 0 ? local / travel : 0);
      }
      // nearest panel (by centre) for active state — panels are not uniform width
      var nearest = 0, nb = Infinity;
      for (var m = 0; m < ns.length; m++) { var a2 = Math.abs(ns[m]); if (a2 < nb) { nb = a2; nearest = m; } }
      setActivePanel(nearest);
    }

    function loop() {
      if (Math.abs(window.scrollY - lastSet) > 2) { current = targetY = window.scrollY; }
      current += (targetY - current) * lerp;
      if (Math.abs(targetY - current) < 0.06) current = targetY;
      window.scrollTo(0, current);
      lastSet = current;
      effects();
      raf = requestAnimationFrame(loop);
    }

    function onResize() { layout(); clamp(); }

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    effects();
    raf = requestAnimationFrame(loop);

    return function cleanup() {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      anchors.forEach(function (a) { a.removeEventListener('click', onAnchor); });
      // reset inline styles
      track.style.transform = '';
      track.style.width = '';
      spacer.style.height = '';
      if (tajineStage) tajineStage.style.transform = '';
      anims.forEach(function (el) { el.style.transform = ''; el.style.opacity = ''; });
    };
  }

  /* ======================================================================
     VERTICAL ENGINE
     ====================================================================== */
  function verticalMode() {
    // staggered reveals — children of each panel cascade in
    panels.forEach(function (p) {
      [].forEach.call(p.querySelectorAll('[data-anim]'), function (el, i) {
        el.style.transitionDelay = Math.min(i * 0.09, 0.4) + 's';
      });
    });

    // scroll-linked parallax on flagged elements (background images)
    var parallaxEls = [].slice.call(document.querySelectorAll('[data-parallax]'));
    function parallax() {
      var vh = window.innerHeight, max = vh * 0.16;
      for (var i = 0; i < parallaxEls.length; i++) {
        var el = parallaxEls[i];
        var sp = parseFloat(el.getAttribute('data-parallax')) || 0.1;
        var r = el.getBoundingClientRect();
        var off = (vh / 2 - (r.top + r.height / 2)) * sp;
        off = off > max ? max : (off < -max ? -max : off);
        el.style.transform = 'translateY(' + off.toFixed(1) + 'px)';
      }
    }

    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      anims.forEach(function (el) { io.observe(el); });
    } else {
      anims.forEach(function (el) { el.classList.add('in'); });
    }

    // active panel + progress on scroll
    var panelIO = null;
    if ('IntersectionObserver' in window) {
      panelIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) setActivePanel(panels.indexOf(en.target));
        });
      }, { threshold: 0.5 });
      panels.forEach(function (p) { panelIO.observe(p); });
    }

    function onScroll() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      if (progress) progress.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
      nav.classList.toggle('is-scrolled', h.scrollTop > 40);
      scrubVertical();
      if (tajineSection) {
        var tr = tajineSection.getBoundingClientRect();
        var total = tajineSection.offsetHeight - window.innerHeight;
        updateTajine(total > 0 ? (-tr.top) / total : 0);
      }
      parallax();
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // anchor links → native smooth scroll (closes mobile menu)
    function onAnchor(e) {
      var id = e.currentTarget.getAttribute('data-link');
      var el = document.getElementById(id);
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); closeNav(); }
    }
    var anchors = [].slice.call(document.querySelectorAll('a[data-link]'));
    anchors.forEach(function (a) { a.addEventListener('click', onAnchor); });

    return function cleanup() {
      if (io) io.disconnect();
      if (panelIO) panelIO.disconnect();
      window.removeEventListener('scroll', onScroll);
      anchors.forEach(function (a) { a.removeEventListener('click', onAnchor); });
      panels.forEach(function (p) {
        [].forEach.call(p.querySelectorAll('[data-anim]'), function (el) { el.style.transitionDelay = ''; });
      });
      parallaxEls.forEach(function (el) { el.style.transform = ''; });
    };
  }

  /* ======================================================================
     MODE SWITCHING
     ====================================================================== */
  function apply() {
    var horizontal = mqDesktop.matches && !mqReduce.matches;
    setMode(horizontal);
    currentPanel = -1;
    if (active) { active(); active = null; }
    window.scrollTo(0, 0);
    active = horizontal ? horizontalMode() : verticalMode();
  }
  apply();

  var reTimer;
  function onModeMaybeChanged() {
    clearTimeout(reTimer);
    reTimer = setTimeout(function () {
      var horizontal = mqDesktop.matches && !mqReduce.matches;
      if (horizontal !== docEl.classList.contains('mode-horizontal')) apply();
    }, 200);
  }
  (mqDesktop.addEventListener ? mqDesktop.addEventListener('change', onModeMaybeChanged)
    : mqDesktop.addListener(onModeMaybeChanged));
  (mqReduce.addEventListener ? mqReduce.addEventListener('change', onModeMaybeChanged)
    : mqReduce.addListener(onModeMaybeChanged));

  /* ======================================================================
     LANGUAGE (FR / EN)
     ====================================================================== */
  var i18nEls = [].slice.call(document.querySelectorAll('[data-en]'));
  i18nEls.forEach(function (el) { el._fr = el.innerHTML; });
  var phEls = [].slice.call(document.querySelectorAll('[data-en-ph]'));
  phEls.forEach(function (el) { el._frph = el.getAttribute('placeholder') || ''; });
  var langOpts = [].slice.call(document.querySelectorAll('[data-lang-opt]'));
  var currentLang = 'fr';

  function applyLang(lang) {
    currentLang = (lang === 'en') ? 'en' : 'fr';
    var en = currentLang === 'en';
    i18nEls.forEach(function (el) {
      el.innerHTML = en ? (el.getAttribute('data-en') || el._fr) : el._fr;
    });
    phEls.forEach(function (el) {
      el.setAttribute('placeholder', en ? (el.getAttribute('data-en-ph') || el._frph) : el._frph);
    });
    document.documentElement.setAttribute('lang', currentLang);
    langOpts.forEach(function (o) { o.classList.toggle('is-on', o.getAttribute('data-lang-opt') === currentLang); });
    try { localStorage.setItem('kawtarLang', currentLang); } catch (e) {}
    if (typeof tajineActive !== 'undefined' && tajineActive >= 0) setTajineName(tajineActive);
  }

  (function () {
    var saved = 'fr';
    try { saved = localStorage.getItem('kawtarLang') || 'fr'; } catch (e) {}
    applyLang(saved);
  })();

  [].forEach.call(document.querySelectorAll('[data-lang-toggle]'), function (b) {
    b.addEventListener('click', function () { applyLang(currentLang === 'en' ? 'fr' : 'en'); });
  });

  /* ======================================================================
     MOBILE NAV
     ====================================================================== */
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  function closeNav() {
    if (!navLinks) return;
    navLinks.classList.remove('is-open');
    navToggle.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
  }
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('nav-open', open);
    });
  }

  /* ======================================================================
     STAT COUNTERS
     ====================================================================== */
  function runCounters() {
    var nums = [].slice.call(document.querySelectorAll('[data-count]'));
    nums.forEach(function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      var suffix = el.getAttribute('data-suffix') || '';
      var dur = 1400, t0 = 0;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  var counterDone = false;
  if ('IntersectionObserver' in window) {
    var statIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !counterDone) { counterDone = true; runCounters(); statIO.disconnect(); }
      });
    }, { threshold: 0.4 });
    var statBlock = document.querySelector('.stats');
    if (statBlock) statIO.observe(statBlock);
  }

  /* ======================================================================
     RESERVATION MODAL
     ====================================================================== */
  var modal = document.getElementById('reserveModal');
  var form = document.getElementById('reserveForm');
  var done = document.getElementById('reserveDone');
  var lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    // default date = today
    var d = form.querySelector('input[name="date"]');
    if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
    var first = form.querySelector('input[name="name"]');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  [].forEach.call(document.querySelectorAll('[data-reserve]'), function (b) {
    b.addEventListener('click', function () { closeNav(); openModal(); });
  });
  [].forEach.call(modal.querySelectorAll('[data-modal-close]'), function (b) {
    b.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = true;
    ['name', 'phone', 'date', 'time'].forEach(function (n) {
      var f = form.querySelector('[name="' + n + '"]');
      if (f && !f.value.trim()) { f.classList.add('invalid'); ok = false; }
      else if (f) f.classList.remove('invalid');
    });
    if (!ok) return;

    var name = form.querySelector('[name="name"]').value.trim();
    var date = form.querySelector('[name="date"]').value;
    var time = form.querySelector('[name="time"]').value;
    var guests = form.querySelector('[name="guests"]').value;

    var en = currentLang === 'en';
    var nm = esc(name || (en ? 'friend' : 'l’ami'));
    var dHead = done.querySelector('[data-done-head]');
    var dBody = done.querySelector('[data-done-body]');
    if (en) {
      dHead.innerHTML = 'Thank you, <span>' + nm + '</span>.';
      dBody.innerHTML = 'Your request for <span>' + guests + ' guest' + (guests === '1' ? '' : 's') +
        '</span> on ' + formatDate(date, 'en') + ' at ' + time +
        ' has been received. We’ll call you shortly to confirm. <em>Bslama.</em>';
    } else {
      dHead.innerHTML = 'Merci, <span>' + nm + '</span>.';
      dBody.innerHTML = 'Votre demande pour <span>' + guests + ' couvert' + (guests === '1' ? '' : 's') +
        '</span> le ' + formatDate(date, 'fr') + ' à ' + time +
        ' est bien reçue. Nous vous rappelons sous peu pour confirmer. <em>Bslama.</em>';
    }

    form.hidden = true;
    done.hidden = false;
  });

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function formatDate(iso, lang) {
    if (!iso) return '';
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-CA' : 'fr-FR', { day: 'numeric', month: 'long' });
    } catch (e) { return iso; }
  }
})();
