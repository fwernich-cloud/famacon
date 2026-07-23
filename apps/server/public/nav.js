/* Shared site chrome: mega-menu header + footer. Injected on every marketing page
   so there's a single source of truth. Sets the active tab, wires the dropdowns
   (hover on desktop, click on touch) and the mobile accordion. */
(function () {
  var NAV = [
    { label: 'Famacon Control', items: [
      ['Cómo funciona', '/como-funciona'],
      ['El tablero', '/tablero'],
      ['Diagnóstico y alertas', '/alertas'],
      ['WhatsApp y avisos', '/whatsapp'],
      ['Precios', '/precios'],
      ['Preguntas frecuentes', '/faq'],
    ], feat: { eyebrow: 'Piloto en marcha', title: 'Probá el tablero', cta: ['Solicitar demo', '/contacto'] } },
    { label: 'Empresa', items: [
      ['Nosotros', '/nosotros'],
      ['Obras / Instalaciones', '/obras'],
      ['Novedades', '/novedades'],
      ['Trabajá con nosotros', '/trabajo'],
    ] },
    { label: 'Contacto', href: '/contacto' },
  ];

  // Line icons for feature cards (stroke = currentColor). Injected by data-icon.
  var ICONS = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    whatsapp: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20.5l1.6-4.9A8.5 8.5 0 1 1 20.5 11.5z"/><path d="M8.6 8.4c-.3 0-.6.1-.8.4-.3.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.7 2.9 4.3 3.9 2.1.8 2.6.7 3 .6.6-.1 1.4-.6 1.6-1.2.2-.6.2-1 .1-1.2-.1-.1-.3-.2-.6-.4-.3-.2-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.7 1-.1.1-.3.1-.5 0-.3-.1-1.1-.4-2-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.4c.1-.2.2-.3.2-.5s0-.3-.1-.5c0-.1-.5-1.3-.7-1.8-.1-.4-.3-.4-.5-.4z" fill="currentColor" stroke="none"/>',
    history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    template: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
    consent: '<path d="M22 11.5V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14.01l-3-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
    pattern: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    drop: '<path d="M12 2.7S6 9 6 13.5a6 6 0 0 0 12 0C18 9 12 2.7 12 2.7z"/>',
    signal: '<path d="M4 20V10"/><path d="M9 20V6"/><path d="M14 20v-9"/><path d="M19 20V4"/>',
  };

  // A day of Famacon Control alerts — rendered into every phone as a live,
  // auto-scrolling WhatsApp chat.
  var CHAT = [
    { day: 'HOY' },
    { hd: 'Famacon Control · Aviso', t: '06:40', b: 'Campo Punta Indio<br><b>Molino MOL-02</b> — tanque tank_02 al 18%, por debajo del mínimo. Revisar el molino.' },
    { hd: 'Famacon Control · Normalizado', t: '07:05', b: '<b>Molino MOL-02</b> funcionando. Tanque tank_02 subiendo.' },
    { hd: 'Famacon Control · Aviso', t: '08:15', b: '<b>Molino MOL-04</b> — tanque bajando: 46% → 34% en 24 h, con el molino funcionando. Revisá cuero/válvula o el consumo del rodeo.' },
    { hd: 'Famacon Control · Normalizado', t: '09:40', b: '<b>Molino MOL-01</b> volvió a bombear. Tanque tank_01 recuperando nivel.' },
    { hd: 'Famacon Control · Aviso urgente', t: '11:02', u: true, b: '<b>Bomba BE-01</b> parada y tanque tank_01 bajando (31%). Sin reposición — revisar la bomba.' },
    { hd: 'Famacon Control · Normalizado', t: '11:48', b: '<b>Bomba BE-01</b> en marcha. Tanque tank_01 recuperando.' },
    { hd: 'Famacon Control · Preventivo', t: '14:20', b: 'Señal del campo debilitándose (RSSI −98 dBm). Posible corte próximo en la zona.' },
    { hd: 'Famacon Control · Aviso', t: '16:30', b: 'Batería del sensor <b>TQ-03</b> baja (3,1 V). Conviene programar el cambio.' },
  ];
  function chatHTML() {
    return CHAT.map(function (m) {
      if (m.day) return '<div class="wa-day"><span>' + m.day + '</span></div>';
      return '<div class="wa-msg' + (m.u ? ' urgent' : '') + '"><span class="hd">' + m.hd + '</span>' +
        m.b + '<span class="meta">' + m.t + ' <span class="ck">✓✓</span></span></div>';
    }).join('');
  }
  var MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M18 11a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.9V22h2v-3.1A8 8 0 0 0 20 11z"/></svg>';
  // Smoothly auto-scroll a chat (ping-pong, pauses at ends, stops on hover).
  function autoScroll(el, sb, speed) {
    speed = speed || 0.5;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    var dir = 1, hold = 70, hover = false, pos = 0;   // pos: float accumulator (scrollTop rounds)
    el.addEventListener('mouseenter', function () { hover = true; });
    el.addEventListener('mouseleave', function () { hover = false; pos = el.scrollTop; });
    function paintSB() {
      if (!sb) return;
      var ch = el.clientHeight, max = el.scrollHeight - el.clientHeight;
      var th = Math.max(26, ch * ch / el.scrollHeight);
      var frac = max > 0 ? el.scrollTop / max : 0;
      sb.style.height = th + 'px';
      sb.style.top = (el.offsetTop + frac * (ch - th)) + 'px';
    }
    function tick() {
      if (!reduce && !hover) {
        if (hold > 0) hold--;
        else {
          var max = el.scrollHeight - el.clientHeight;
          if (max > 2) {
            pos += dir * speed;
            if (pos >= max) { pos = max; dir = -1; hold = 120; }
            else if (pos <= 0) { pos = 0; dir = 1; hold = 120; }
            el.scrollTop = pos;
          }
        }
      }
      paintSB();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var path = location.pathname.replace(/\/index\.html?$/, '/').replace(/\.html$/, '') || '/';
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };

  function topLevel(n) {
    var active = (n.href && n.href === path) || (n.items && n.items.some(function (it) { return it[1] === path; }));
    var cls = 'top' + (active ? ' active' : '');
    if (n.href) return '<li><a class="' + cls + '" href="' + n.href + '">' + esc(n.label) + '</a></li>';
    var cols = n.items.map(function (it) {
      var a = it[1] === path ? ' class="on"' : '';
      return '<a' + a + ' href="' + it[1] + '">' + esc(it[0]) + '</a>';
    }).join('');
    var feat = n.feat ? '<div class="drop-feat"><div class="eyebrow">' + esc(n.feat.eyebrow) + '</div>' +
      '<h4>' + esc(n.feat.title) + '</h4><a class="btn" href="' + n.feat.cta[1] + '">' + esc(n.feat.cta[0]) + '</a></div>' : '';
    return '<li class="has-drop"><button class="' + cls + '" aria-haspopup="true" aria-expanded="false">' + esc(n.label) +
      ' <span class="caret">▾</span></button>' +
      '<div class="drop"><div class="wrap drop-inner"><div class="drop-cols">' + cols + '</div>' + feat + '</div></div></li>';
  }

  var header =
    '<header class="site-head" id="siteHead"><div class="wrap nav-wrap">' +
      '<a href="/" class="brand"><span class="n">Famacon&nbsp;Control</span><span class="t">Monitoreo de campo</span></a>' +
      '<button class="nav-toggle" id="navToggle" aria-label="Abrir menú" aria-expanded="false" aria-controls="mega">☰</button>' +
      '<nav class="mega" id="mega"><ul class="mega-nav">' + NAV.map(topLevel).join('') + '</ul>' +
      '<a href="/login" class="btn nav-cta">Ingresar</a></nav>' +
    '</div></header>';

  var footer =
    '<footer class="site-foot"><div class="wrap foot-grid">' +
      '<div class="fb"><span class="n">Famacon Control</span>' +
        '<p>Monitoreo remoto de molinos y bombas para campos ganaderos: cruzamos el nivel del tanque con el estado del equipo y avisamos por WhatsApp.</p>' +
        '<p class="by">Por <a href="https://famacon.com.ar" target="_blank" rel="noopener">Famacon</a>&nbsp;— fabricante de molinos Huracán y Hércules desde 1981.</p></div>' +
      '<div><h4>Control</h4><a href="/como-funciona">Cómo funciona</a><a href="/alertas">Diagnóstico y alertas</a><a href="/whatsapp">WhatsApp y avisos</a><a href="/faq">Preguntas frecuentes</a></div>' +
      '<div><h4>Empresa</h4><a href="/nosotros">Nosotros</a><a href="/obras">Obras</a><a href="/contacto">Contacto</a></div>' +
      '<div><h4>Legal</h4><a href="/privacidad">Privacidad</a><a href="/terminos">Términos</a><a href="/login">Ingresar</a></div>' +
    '</div><div class="foot-bar"><div class="wrap">' +
      '<span>© 2026 Famacon S.A. — Buenos Aires — Argentina</span>' +
      '<span>Datos personales protegidos · Ley 25.326</span>' +
    '</div></div></footer>';

  function mount() {
    var h = document.getElementById('site-header');
    var f = document.getElementById('site-footer');
    if (h) h.outerHTML = header;
    if (f) f.outerHTML = footer;

    // Floating "Escribinos por WhatsApp" button (site-wide). Set WA_NUMBER to the
    // commercial number (country code, digits only, no + or spaces) to turn it into
    // a direct chat; until then it falls back to the contact form.
    var WA_NUMBER = '5491131796848';  // +54 9 11 3179-6848
    var WA_TEXT = 'Hola, quiero saber más sobre Famacon Control para mi campo.';
    if (!document.querySelector('.wa-fab')) {
      var fab = document.createElement('a');
      fab.className = 'wa-fab';
      fab.href = WA_NUMBER ? ('https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(WA_TEXT)) : '/contacto';
      fab.setAttribute('aria-label', 'Escribinos por WhatsApp');
      if (WA_NUMBER) { fab.target = '_blank'; fab.rel = 'noopener'; }
      fab.innerHTML = '<svg viewBox="0 0 32 32" fill="#fff" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.1 1.6 5.9L4 29l8.3-1.6c1.7.9 3.6 1.4 5.7 1.4 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-4.9 1 1-4.8-.3-.4C5.5 18.3 5 16.7 5 15 5 9 9.9 4.1 16 4.1S27 9 27 15 22.1 24.8 16 24.8z"/><path d="M22 18.3c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6 0-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4z"/></svg>';
      document.body.appendChild(fab);
    }

    // Skip-to-content link + main landmark on the first content section.
    if (!document.querySelector('.skip')) {
      var skip = document.createElement('a');
      skip.className = 'skip'; skip.href = '#contenido'; skip.textContent = 'Saltar al contenido';
      document.body.insertBefore(skip, document.body.firstChild);
    }
    var head = document.getElementById('siteHead');
    var first = head && head.nextElementSibling;
    while (first && (first.classList.contains('creds') || first.tagName === 'SCRIPT')) first = first.nextElementSibling;
    if (first && !document.getElementById('contenido')) { first.id = 'contenido'; first.setAttribute('tabindex', '-1'); }

    var toggle = document.getElementById('navToggle');
    var mega = document.getElementById('mega');
    if (toggle && mega) toggle.addEventListener('click', function () {
      var open = mega.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Touch/click: open a dropdown by clicking its top button (desktop uses hover via CSS).
    document.querySelectorAll('.has-drop > button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var li = btn.parentElement;
        var wasOpen = li.classList.contains('open');
        document.querySelectorAll('.has-drop.open').forEach(function (x) {
          x.classList.remove('open');
          var b = x.querySelector('button'); if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) { li.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    // Inject line icons into any element carrying data-icon.
    document.querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.dataset.iconDone) return;
      var g = ICONS[el.getAttribute('data-icon')];
      if (!g) return;
      el.dataset.iconDone = '1';
      var d = document.createElement('div'); d.className = 'ficon';
      d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + g + '</svg>';
      el.insertBefore(d, el.firstChild);
    });

    // Dress every .phone as a realistic iPhone: side buttons, Dynamic Island,
    // iOS status bar (time · signal · wifi · battery) and the home indicator.
    var STAT = {
      cell: '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>',
      wifi: '<svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true"><path d="M8.5 2C5.4 2 2.6 3.2.6 5.2l1.5 1.6C3.7 5.2 6 4.1 8.5 4.1s4.8 1.1 6.4 2.7l1.5-1.6C14.4 3.2 11.6 2 8.5 2zm0 4.1c-1.8 0-3.4.7-4.6 1.9l1.6 1.6c.8-.8 1.9-1.3 3-1.3s2.2.5 3 1.3l1.6-1.6C11.9 6.8 10.3 6.1 8.5 6.1zm0 4c-.7 0-1.3.3-1.8.8L8.5 12l1.8-1.1c-.5-.5-1.1-.8-1.8-.8z"/></svg>',
      bat: '<svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x="1" y="1" width="22" height="11" rx="3.2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/><rect x="2.6" y="2.6" width="16.5" height="7.8" rx="1.6" fill="#fff"/><path d="M24.6 4.5c1 .3 1 3.7 0 4z" fill="#fff" opacity=".55"/></svg>',
    };
    document.querySelectorAll('.phone').forEach(function (ph) {
      if (ph.dataset.iph) return; ph.dataset.iph = '1';
      ['b-mute', 'b-vup', 'b-vdn', 'b-pow'].forEach(function (c) {
        var i = document.createElement('i'); i.className = 'pb ' + c; ph.appendChild(i);
      });
      var scr = ph.querySelector('.screen'); if (!scr) return;
      var old = scr.querySelector('.notch'); if (old) old.remove();
      var sb = document.createElement('div'); sb.className = 'statusbar';
      sb.innerHTML = '<span class="time">9:41</span><span class="sys">' + STAT.cell + STAT.wifi + STAT.bat + '</span>';
      var isl = document.createElement('div'); isl.className = 'island';
      var wb = scr.querySelector('.wa-body');
      if (wb) {
        wb.innerHTML = '<div class="wa-track">' + chatHTML() + '</div>';
        var ft = document.createElement('div'); ft.className = 'wa-foot';
        ft.innerHTML = '<div class="field"><span>Mensaje</span><span class="clip">&#128206;</span></div>' +
          '<div class="mic">' + MIC + '</div>';
        wb.after(ft);
        var sbi = document.createElement('div'); sbi.className = 'wa-sb'; scr.appendChild(sbi);
        autoScroll(wb, sbi);
      }
      scr.insertBefore(sb, scr.firstChild);
      scr.insertBefore(isl, scr.firstChild);
      var hi = document.createElement('div'); hi.className = 'home-ind'; scr.appendChild(hi);
      // Make explicit: it's not an app, it's WhatsApp.
      if (!ph.nextElementSibling || !ph.nextElementSibling.classList.contains('phone-note')) {
        ph.insertAdjacentHTML('afterend',
          '<p class="phone-note">No es una app — llega por WhatsApp, sin instalar nada.</p>');
      }
    });

    // Scrollable browser-window screenshots: gentle auto-scroll + scroll indicator.
    document.querySelectorAll('.shot.scroll').forEach(function (sh) {
      if (sh.dataset.sc) return; sh.dataset.sc = '1';
      var win = sh.querySelector('.win'); if (!win) return;
      var sb = document.createElement('div'); sb.className = 'win-sb'; sh.appendChild(sb);
      autoScroll(win, sb, 0.9);
    });

    var track = document.getElementById('track');
    if (track && !track.dataset.dup) { track.dataset.dup = '1'; track.innerHTML += track.innerHTML; }

    document.querySelectorAll('.vtrack').forEach(function (t) { if (!t.dataset.dup) { t.dataset.dup = '1'; t.innerHTML += t.innerHTML; } });

    // FAQ accordion: single-open, smooth expand.
    document.querySelectorAll('.faq .acc-q').forEach(function (q) {
      q.setAttribute('aria-expanded', q.parentElement.classList.contains('open') ? 'true' : 'false');
      q.addEventListener('click', function () {
        var acc = q.parentElement, open = acc.classList.contains('open');
        acc.closest('.faq').querySelectorAll('.acc.open').forEach(function (x) {
          x.classList.remove('open');
          var b = x.querySelector('.acc-q'); if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!open) { acc.classList.add('open'); q.setAttribute('aria-expanded', 'true'); }
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.has-drop')) document.querySelectorAll('.has-drop.open').forEach(function (x) { x.classList.remove('open'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
