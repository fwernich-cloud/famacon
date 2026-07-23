/* Shared site chrome: mega-menu header + footer. Injected on every marketing page
   so there's a single source of truth. Sets the active tab, wires the dropdowns
   (hover on desktop, click on touch) and the mobile accordion. */
(function () {
  var NAV = [
    { label: 'Famacon Control', items: [
      ['Cómo funciona', '/como-funciona'],
      ['El tablero', '/tablero'],
      ['Diagnóstico y alertas', '/alertas'],
      ['WhatsApp y datos', '/whatsapp'],
      ['Precios', '/precios'],
      ['Preguntas frecuentes', '/faq'],
    ], feat: { eyebrow: 'Piloto en marcha', title: 'Probá el tablero', cta: ['Solicitar demo', '/contacto'] } },
    { label: 'Productos', items: [
      ['Molinos Huracán', '/huracan'],
      ['Molinos Hércules', '/hercules'],
      ['Bombas', '/bombas'],
      ['Repuestos y servicio', '/repuestos'],
      ['Descargas', '/descargas'],
    ], feat: { eyebrow: 'Desde 1981', title: '¿Qué molino necesito?', cta: ['Ver molinos', '/huracan'] } },
    { label: 'Empresa', items: [
      ['Nosotros', '/nosotros'],
      ['Obras / Instalaciones', '/obras'],
      ['Novedades', '/novedades'],
      ['Trabajá con nosotros', '/trabajo'],
    ] },
    { label: 'Inversores', href: '/inversores' },
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
    return '<li class="has-drop"><button class="' + cls + '" aria-haspopup="true">' + esc(n.label) +
      ' <span class="caret">▾</span></button>' +
      '<div class="drop"><div class="wrap drop-inner"><div class="drop-cols">' + cols + '</div>' + feat + '</div></div></li>';
  }

  var header =
    '<header class="site-head" id="siteHead"><div class="wrap nav-wrap">' +
      '<a href="/" class="brand"><span class="n">Famacon&nbsp;Control</span><span class="t">Monitoreo de campo</span></a>' +
      '<button class="nav-toggle" id="navToggle" aria-label="Abrir menú">☰</button>' +
      '<nav class="mega" id="mega"><ul class="mega-nav">' + NAV.map(topLevel).join('') + '</ul>' +
      '<a href="/login" class="btn nav-cta">Ingresar</a></nav>' +
    '</div></header>';

  var footer =
    '<footer class="site-foot"><div class="wrap foot-grid">' +
      '<div class="fb"><span class="n">Famacon Control</span>' +
        '<p>Monitoreo remoto de molinos y bombas para campos ganaderos. Un producto de Famacon S.A., fabricante de molinos Huracán y Hércules desde 1981.</p></div>' +
      '<div><h4>Control</h4><a href="/como-funciona">Cómo funciona</a><a href="/alertas">Diagnóstico y alertas</a><a href="/whatsapp">WhatsApp y datos</a><a href="/faq">Preguntas frecuentes</a></div>' +
      '<div><h4>Productos</h4><a href="/huracan">Molinos Huracán</a><a href="/hercules">Molinos Hércules</a><a href="/bombas">Bombas</a><a href="/descargas">Descargas</a></div>' +
      '<div><h4>Empresa</h4><a href="/nosotros">Nosotros</a><a href="/obras">Obras</a><a href="/inversores">Inversores</a><a href="/contacto">Contacto</a></div>' +
      '<div><h4>Legal</h4><a href="/privacidad">Privacidad</a><a href="/terminos">Términos</a><a href="/login">Ingresar</a></div>' +
    '</div><div class="foot-bar"><div class="wrap">' +
      '<span>© 2026 Famacon S.A. — Verónica, Buenos Aires · Argentina</span>' +
      '<span>Datos personales protegidos · Ley 25.326</span>' +
    '</div></div></footer>';

  function mount() {
    var h = document.getElementById('site-header');
    var f = document.getElementById('site-footer');
    if (h) h.outerHTML = header;
    if (f) f.outerHTML = footer;

    var toggle = document.getElementById('navToggle');
    var mega = document.getElementById('mega');
    if (toggle && mega) toggle.addEventListener('click', function () { mega.classList.toggle('open'); });

    // Touch/click: open a dropdown by clicking its top button (desktop uses hover via CSS).
    document.querySelectorAll('.has-drop > button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var li = btn.parentElement;
        var wasOpen = li.classList.contains('open');
        document.querySelectorAll('.has-drop.open').forEach(function (x) { x.classList.remove('open'); });
        if (!wasOpen) li.classList.add('open');
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
      scr.insertBefore(sb, scr.firstChild);
      scr.insertBefore(isl, scr.firstChild);
      var hi = document.createElement('div'); hi.className = 'home-ind'; scr.appendChild(hi);
    });

    var track = document.getElementById('track');
    if (track && !track.dataset.dup) { track.dataset.dup = '1'; track.innerHTML += track.innerHTML; }

    document.querySelectorAll('.vtrack').forEach(function (t) { if (!t.dataset.dup) { t.dataset.dup = '1'; t.innerHTML += t.innerHTML; } });

    // FAQ accordion: single-open, smooth expand.
    document.querySelectorAll('.faq .acc-q').forEach(function (q) {
      q.addEventListener('click', function () {
        var acc = q.parentElement, open = acc.classList.contains('open');
        acc.closest('.faq').querySelectorAll('.acc.open').forEach(function (x) { x.classList.remove('open'); });
        if (!open) acc.classList.add('open');
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.has-drop')) document.querySelectorAll('.has-drop.open').forEach(function (x) { x.classList.remove('open'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
