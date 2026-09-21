// ── Login gate ─────────────────────────────────────────
let sessionPassword = null; // mot de passe tapé, gardé en mémoire le temps de la session
let authMode = null;        // 'guest' | 'google'
let googleUserEmail = '';
let googleUserPicture = '';

function checkLogin() {
  showLogin();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-wrapper').style.display = 'none';
  setTimeout(() => document.getElementById('login-input').focus(), 100);
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-wrapper').style.display = 'contents';
  document.getElementById('main-content').innerHTML = '<p style="font-family:var(--mono);color:var(--muted);padding:24px 0">Chargement des problèmes…</p>';
  renderSessionIndicator();
  try {
    await problemsPromise;
  } catch (e) {
    document.getElementById('main-content').innerHTML = `<p style="font-family:var(--mono);color:var(--danger);padding:24px 0">${e.message}</p>`;
    return;
  }
  buildSelector();
  renderProblem(0);
  renderFiltersPanel();
}

function showLoginError(message) {
  const el = document.getElementById('login-error');
  el.textContent = message || 'Mot de passe incorrect';
  el.classList.add('on');
  const box = document.getElementById('login-box');
  box.style.animation = 'none';
  box.offsetHeight;
  box.style.animation = 'shake .4s ease';
}

async function submitLogin() {
  const val = document.getElementById('login-input').value.trim();
  if (!val) return;

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Vérification…';

  // Teste le mot de passe contre le worker
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: val, prompt: 'ping' })
    });

    if (res.status === 401) {
      throw new Error('incorrect');
    }

    // Mot de passe accepté — on le garde en mémoire
    sessionPassword = val;
    authMode = 'guest';
    sessionStorage.setItem('auth_mode', 'guest');
    document.getElementById('login-error').classList.remove('on');
    loadModelCatalog(); // en parallèle : n'a pas besoin d'attendre le chargement des problèmes
    await showApp();

  } catch(e) {
    showLoginError('Mot de passe incorrect');
    document.getElementById('login-input').value = '';
    document.getElementById('login-input').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Accéder';
  }
}

// ── Connexion Google (OAuth 2.0 + PKCE, sans backend supplémentaire) ────
let GOOGLE_CLIENT_ID_FROM_CONFIG = '';
let GOOGLE_OAUTH_ENABLED = false;

async function loadAuthConfig() {
  try {
    const res = await fetch(workerUrlFor('config'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    GOOGLE_CLIENT_ID_FROM_CONFIG = data.google_client_id || '';
    GOOGLE_OAUTH_ENABLED = !!(data.google_oauth_enabled && GOOGLE_CLIENT_ID_FROM_CONFIG);
  } catch (e) {
    console.error('Impossible de charger la configuration', e);
    GOOGLE_OAUTH_ENABLED = false;
  }
  const googleCard = document.getElementById('google-login-card');
  const divider = document.getElementById('login-divider');
  if (googleCard) googleCard.style.display = GOOGLE_OAUTH_ENABLED ? '' : 'none';
  if (divider) divider.style.display = GOOGLE_OAUTH_ENABLED ? '' : 'none';
}

function generateRandomString(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startGoogleLogin() {
  if (!GOOGLE_CLIENT_ID_FROM_CONFIG) return;

  const codeVerifier = generateRandomString(64);
  const codeChallenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier)));

  sessionStorage.setItem('pkce_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', generateRandomString(16));

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID_FROM_CONFIG,
    redirect_uri: window.location.origin + window.location.pathname,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/cloud-platform openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: sessionStorage.getItem('oauth_state'),
    access_type: 'offline',
    prompt: 'consent',
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

async function exchangeCodeForToken(code) {
  const res = await fetch(workerUrlFor('oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: sessionStorage.getItem('pkce_verifier'),
      redirect_uri: window.location.origin + window.location.pathname,
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error || 'Échec de l\'authentification Google');

  sessionStorage.setItem('google_access_token', data.access_token);
  sessionStorage.setItem('google_refresh_token', data.refresh_token || '');
  sessionStorage.setItem('google_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
  sessionStorage.setItem('google_user_email', data.email || '');
  sessionStorage.setItem('google_user_picture', data.picture || '');
  sessionStorage.setItem('auth_mode', 'google');

  authMode = 'google';
  googleUserEmail = data.email || '';
  googleUserPicture = data.picture || '';

  loadModelCatalog();
  await showApp();
}

// Rafraîchit l'access_token s'il expire dans moins de 5 minutes. Appelé avant
// chaque requête au worker en mode Google (voir buildAuthBody()).
async function getValidAccessToken() {
  const expiry = parseInt(sessionStorage.getItem('google_token_expiry') || '0', 10);
  if (Date.now() < expiry - 300000) {
    return sessionStorage.getItem('google_access_token');
  }

  const refreshToken = sessionStorage.getItem('google_refresh_token');
  if (!refreshToken) { logout(); return null; }

  const res = await fetch(workerUrlFor('oauth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await res.json();
  if (!data.access_token) { logout(); return null; }

  sessionStorage.setItem('google_access_token', data.access_token);
  sessionStorage.setItem('google_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
  return data.access_token;
}

function renderSessionIndicator() {
  const el = document.getElementById('session-indicator');
  if (!el) return;

  if (authMode === 'google') {
    const email = googleUserEmail || sessionStorage.getItem('google_user_email') || '';
    const picture = googleUserPicture || sessionStorage.getItem('google_user_picture') || '';
    const truncated = email.length > 20 ? email.slice(0, 20) + '…' : email;
    const initial = email ? email[0].toUpperCase() : '?';
    const avatarHtml = picture
      ? `<img src="${picture}" class="session-avatar" alt="">`
      : `<span class="session-avatar session-avatar-fallback">${initial}</span>`;
    el.innerHTML = `${avatarHtml}<span class="session-email" title="${email}">${truncated}</span><button type="button" class="session-logout-btn" onclick="logout()">Déconnexion</button>`;
  } else {
    el.innerHTML = `<span class="session-guest-badge">Mode invité</span><span class="session-guest-note">quota partagé</span>`;
  }
}

function logout() {
  // Révocation du token Google (best effort — on ne bloque pas la déconnexion
  // si cet appel échoue).
  const token = sessionStorage.getItem('google_access_token');
  if (token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
  }
  // Efface la session mais garde les préférences (filtres, modèle choisi, quotas).
  const toKeep = ['ma_filters', 'ma_selected_model', 'ma_quotas'];
  const saved = toKeep.map(k => [k, localStorage.getItem(k)]);
  sessionStorage.clear();
  saved.forEach(([k, v]) => { if (v) localStorage.setItem(k, v); });
  window.location.reload();
}
