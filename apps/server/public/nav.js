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
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.has-drop')) document.querySelectorAll('.has-drop.open').forEach(function (x) { x.classList.remove('open'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
