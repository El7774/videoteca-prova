// Videoteca — configurazione condivisa
// Centralizza API_BASE e helper comuni per evitare duplicazioni in 9 pagine.
// Caricato prima degli script di pagina: <script src="config.js"></script>

var API_BASE = '/api';
var TOKEN_KEY = 'videoteca-token';
var USERNAME_KEY = 'videoteca-username';

// --- Auth helpers ---
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}
function getStoredUsername() {
  return localStorage.getItem(USERNAME_KEY) || sessionStorage.getItem(USERNAME_KEY);
}
function redirectToLogin() {
  localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY); sessionStorage.removeItem(USERNAME_KEY);
  window.location.replace('index.html');
}
function setAuth(token, username, remember) {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USERNAME_KEY, username);
  }
}

// --- Fetch helper (usato da details, genre, homepage, profilo, search, trending, welcome) ---
async function apiFetch(path, options) {
  options = options || {};
  var token = getToken();
  var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var res = await fetch(API_BASE + path, Object.assign({}, options, { headers: headers }));
  var data = null;
  try { data = await res.json(); } catch (e) { /* risposta vuota */ }
  if (!res.ok) {
    var err = new Error((data && data.error) || ('Errore del server (' + res.status + ').'));
    err.status = res.status;
    throw err;
  }
  return data;
}
// Compat per index.html (apiRequest era una variante POST-only)
async function apiRequest(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

// --- Utility comuni ---
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function showNotice(message) {
  var t = document.createElement('div');
  t.className = 'notice-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3200);
}
// Alias per retro-compatibilità (alcune pagine usavano showMsg come toast)
var showMsg = showNotice;
