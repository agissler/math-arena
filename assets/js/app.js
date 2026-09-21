let problemsPromise = null;

document.addEventListener('DOMContentLoaded', async () => {
  problemsPromise = loadAllContent();
  loadAuthConfig(); // en parallèle : ne bloque pas l'affichage de l'écran de login
  document.getElementById('login-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });

  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('model-select-wrap');
    if (wrap && !wrap.contains(e.target)) closeModelDropdown();
  });

  document.getElementById('tutor-attach-row-slot').innerHTML = attachRowHTML('chat');
  const tutorInput = document.getElementById('tutor-chat-input');
  tutorInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTutorMessage(); }
  });
  tutorInput.addEventListener('input', () => {
    tutorInput.style.height = 'auto';
    tutorInput.style.height = Math.min(tutorInput.scrollHeight, 100) + 'px';
  });

  // Retour de redirection depuis Google ?
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const oauthError = urlParams.get('error');

  if (oauthError) {
    window.history.replaceState({}, '', window.location.pathname);
    checkLogin();
    showLoginError('Connexion Google annulée ou refusée.');
    return;
  }

  if (code && state && state === sessionStorage.getItem('oauth_state')) {
    window.history.replaceState({}, '', window.location.pathname);
    try {
      await exchangeCodeForToken(code);
    } catch (e) {
      checkLogin();
      showLoginError(e.message || 'Échec de la connexion Google');
    }
    return;
  }

  // Session Google déjà active (ex : simple refresh de page) ?
  if (sessionStorage.getItem('auth_mode') === 'google' && sessionStorage.getItem('google_access_token')) {
    authMode = 'google';
    googleUserEmail = sessionStorage.getItem('google_user_email') || '';
    googleUserPicture = sessionStorage.getItem('google_user_picture') || '';
    loadModelCatalog();
    await showApp();
    return;
  }

  checkLogin();
});
