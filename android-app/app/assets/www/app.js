/* ============================================================
   Videoteca App — integrazione nativa (Android WebView)
   Caricato in ogni pagina PRIMA di config.js / script di pagina.
   Attivo solo dentro l'app (html[data-minimal]).
   ============================================================ */
(function () {
  'use strict';

  var native = (window.VideotecaNative && typeof window.VideotecaNative.request === 'function')
    ? window.VideotecaNative
    : null;

  // Il backend è fail-closed sul CORS in produzione: le chiamate partono dal
  // layer nativo Android, che non è soggetto a CORS e manda comunque
  // l'header Origin previsto dalle regole del server.
  var APP_ORIGIN = 'https://el7774.github.io';
  var API_ORIGIN = 'https://videoteca-backend.onrender.com';
  var pending = {};
  var reqSeq = 0;
  var lastFilePick = null; // 'export' | 'import'

  if (native) {
    window.VideotecaBridge = {
      onResponse: function (id, status, body, errMsg) {
        var p = pending[id];
        if (!p) return;
        delete pending[id];
        if (errMsg) { p.reject(new Error(errMsg)); return; }
        p.resolve({ status: status, body: body });
      },
      // Risultato del picker file nativo (contenuto del backup JSON come stringa)
      onFilePicked: function (content) {
        if (lastFilePick === 'import' && content != null) {
          try {
            window.dispatchEvent(new MessageEvent('videoteca-import-file', { data: content }));
          } catch (e) { /* ignora */ }
        }
        lastFilePick = null;
      }
    };
  }

  function nativeRequest(method, url, headers, body) {
    return new Promise(function (resolve, reject) {
      var id = String(++reqSeq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        native.request(id, method, url, headers || {}, body == null ? '' : String(body));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }

  // ---- Override di fetch SOLO nell'app (pagine locali, non i CDN) ----
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    init = init || {};
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var method = (init.method || 'GET').toUpperCase();
    // Le chiamate al backend sono relative ("/api/...") o assolute: tutte
    // passano dal bridge nativo, che non è soggetto a CORS.
    var isApi = url.indexOf('/api/') === 0
      || url.indexOf(API_ORIGIN) === 0
      || url.indexOf('http://') === 0
      || url.indexOf('https://') === 0;

    if (native && isApi) {
      if (url.charAt(0) === '/') url = API_ORIGIN + url;
      var headers = {};
      var h = init.headers || {};
      if (h instanceof Headers) {
        h.forEach(function (v, k) { headers[k] = v; });
      } else if (h && typeof h === 'object') {
        Object.keys(h).forEach(function (k) { headers[k] = h[k]; });
      }
      if (!headers['Origin']) headers['Origin'] = APP_ORIGIN;
      var body = init.body == null ? '' : String(init.body);
      return nativeRequest(method, url, headers, body).then(function (res) {
        var status = res.status | 0;
        var text = res.body == null ? '' : String(res.body);
        return {
          ok: status >= 200 && status < 300,
          status: status,
          statusText: '',
          text: function () { return Promise.resolve(text); },
          json: function () {
            try { return Promise.resolve(JSON.parse(text)); }
            catch (e) { return Promise.reject(e); }
          }
        };
      });
    }
    return _fetch(input, init);
  };

  // ---- Confirm / alert / prompt nativi (niente finestre "file:///") ----
  window.addEventListener('beforeunload', function () { /* no-op */ });
  var _confirm = window.confirm.bind(window);
  window.confirm = function (msg) {
    if (!native) return _confirm(msg);
    try { return !!native.confirm(String(msg == null ? '' : msg)); } catch (e) { return _confirm(msg); }
  };

  // ---- Export: salva il backup nella cartella Download via SAF nativo ----
  function interceptExport() {
    var btn = document.getElementById('btnExport');
    if (!btn) return;
    btn.addEventListener('click', function () {
      lastFilePick = 'export';
      apiFetch('/shows').then(function (data) {
        lastFilePick = null;
        var json = JSON.stringify(data, null, 2);
        try {
          native.exportFile('videoteca-backup.json', json);
          showNotice('Backup salvato nella cartella Download.');
        } catch (e) {
          showNotice('Impossibile salvare il backup: ' + e.message);
        }
      }).catch(function () {
        lastFilePick = null;
        showNotice('Impossibile contattare il server.');
      });
    }, true); // capture: previene il download via <a> del sito
  }

  // ---- Import: picker file nativo (application/json) ----
  function interceptImport() {
    var btn = document.getElementById('btnImport');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      lastFilePick = 'import';
      try { native.pickImportFile(); }
      catch (err) { lastFilePick = null; }
    }, true);
  }

  // Sostituisce il flusso del sito dopo che il file è stato letto dal nativo
  function hookImportFlow() {
    var overlay = document.getElementById('importConfirmOverlay');
    if (!overlay) return;
    window.addEventListener('videoteca-import-file', function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
        if (!Array.isArray(data)) throw new Error('formato non valido');
      } catch (err) {
        showNotice('Il file selezionato non è un backup valido.');
        return;
      }
      overlay.style.display = 'flex';
      var yesBtn = document.getElementById('importConfirmYes');
      var noBtn = document.getElementById('importConfirmNo');
      var cleanup = function () { overlay.style.display = 'none'; yesBtn.onclick = null; noBtn.onclick = null; };
      yesBtn.onclick = function () {
        apiFetch('/shows', { method: 'PUT', body: JSON.stringify(data) })
          .then(function () { cleanup(); showNotice('Dati importati correttamente.'); })
          .catch(function (err) { cleanup(); showNotice('Impossibile salvare i dati importati: ' + err.message); });
      };
      noBtn.onclick = cleanup;
    });
  }

  // ---- Pagine protette: reindirizza al login con flag per la nav nativa ----
  function hookAuthGuard() {
    var token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (token) return;
    // La pagina stessa farà replace('index.html'): avvisa il nativo che si torna al login
    try { native && native.authRedirect(); } catch (e) { /* ignora */ }
  }

  // ---- Navigazione link: history reale (serve al tasto back Android) ----
  function hookLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
      if (/^(https?:)?\/\//.test(href)) { // link esterni (es. reset nel browser)
        e.preventDefault();
        try { native && native.openExternal(href); } catch (err) { /* ignora */ }
        return;
      }
      if (a.target === '_blank') e.preventDefault();
      // href relativi: la WebView caricherà la pagina mantenendo la cronologia
    });
  }

  // ---- Bottom navigation minimal (Home · Cerca · Trending · Profilo) ----
  var NAV_ITEMS = [
    { icon: 'M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z', label: 'Home', href: 'homepage.html', page: 'homepage' },
    { icon: 'M10.5 3a7.5 7.5 0 1 1-4.7 13.35L3 19.2V10.5A7.5 7.5 0 0 1 10.5 3Zm0 2A5.5 5.5 0 1 0 16 10.5 5.5 5.5 0 0 0 10.5 5Zm5.2 10.9 4.7 4.7-1.4 1.4-4.7-4.7 1.4-1.4Z', label: 'Cerca', href: 'search.html', page: 'search' },
    { icon: 'M13 2 4.5 13.5h5L9 22l8.5-11.5h-5L13 2Z', label: 'Trending', href: 'trending.html?type=tv', page: 'trending' },
    { icon: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-7 1.7-7 4.5V21h14v-2.5c0-2.8-3.7-4.5-7-4.5Z', label: 'Profilo', href: 'profilo.html', page: 'profilo' }
  ];

  function isNavActive(item) {
    var p = location.pathname.split('/').pop() || 'index.html';
    if (item.page === 'search') return p === 'search.html';
    if (item.page === 'trending') return p === 'trending.html' || p === 'genre.html' || p === 'details.html';
    if (item.page === 'profilo') return p === 'profilo.html';
    return p === 'homepage.html' || p === 'welcome.html';
  }

  function injectBottomNav() {
    var p = location.pathname.split('/').pop() || 'index.html';
    if (p === 'index.html' || p === 'reset-password.html') return; // solo pagine autenticate
    var nav = document.createElement('nav');
    nav.className = 'app-bottomnav';
    nav.innerHTML = NAV_ITEMS.map(function (it) {
      return '<a href="' + it.href + '" class="' + (isNavActive(it) ? 'active' : '') + '">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + it.icon + '"/></svg>' +
        '<span>' + it.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
  }

  // ---- Safe-area: aggiunge padding per status bar / gesture bar ----
  function applySafeArea() {
    var s = getSafeArea();
    document.documentElement.style.setProperty('--safe-top', s.top + 'px');
    document.documentElement.style.setProperty('--safe-bottom', s.bottom + 'px');
  }
  function getSafeArea() {
    var out = { top: 0, bottom: 0 };
    try {
      if (native && typeof native.getSafeArea === 'function') {
        var raw = native.getSafeArea(); // "top,bottom"
        var parts = String(raw || '0,0').split(',');
        out.top = parseInt(parts[0], 10) || 0;
        out.bottom = parseInt(parts[1], 10) || 0;
      }
    } catch (e) { /* ignora */ }
    return out;
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.setAttribute('data-minimal', '1');
    if (!native) return; // aperto in browser normale: nessuna integrazione
    applySafeArea();
    hookAuthGuard();
    hookLinks();
    if (location.pathname.split('/').pop() === 'profilo.html') {
      interceptExport();
      interceptImport();
      hookImportFlow();
    }
    injectBottomNav();
  });

  // Segnala al nativo che la pagina è pronta (per nascondere lo splash)
  window.addEventListener('load', function () {
    try { native && native.pageReady(); } catch (e) { /* ignora */ }
  });
})();
