// ── Tutor (chatbot professeur) ─────────────────────────
let tutorHistory = []; // {role:'user'|'assistant', text, images}
let tutorLoading = false;
let tutorMsgTimer = null;
const tutorMsgs = ['Réflexion en cours…','Je regarde ça…','Un instant…'];

function workerUrlFor(path) {
  return WORKER_URL.endsWith('/') ? WORKER_URL + path : WORKER_URL + '/' + path;
}

// Corps d'authentification à fusionner dans chaque requête au worker : mot de
// passe partagé en mode invité, access_token personnel (rafraîchi si besoin)
// en mode Google.
async function buildAuthBody() {
  if (authMode === 'google') {
    const token = await getValidAccessToken();
    if (!token) throw new Error('Session Google expirée — reconnectez-vous.');
    return { access_token: token };
  }
  return { password: sessionPassword };
}

// ── Tutor (chatbot professeur) ─────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getCurrentContextText() {
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'annales') {
    const s = ANNALES.find(a => a.id === currentSujetId);
    return s ? `L'étudiant consulte actuellement le sujet de concours : ${s.concours} ${s.filiere} ${s.annee} — ${s.epreuve}. S'il te pose une question dessus, demande-lui de préciser le numéro de la question si besoin.` : '';
  }
  const p = PROBLEMS[currentIdx];
  if (!p) return '';
  const context = p.correction || p.grading_context || '';
  return `L'étudiant est actuellement sur l'exercice ou la question de cours suivant(e) :\n${fullStatementText(p)}\n\nSolution de référence (réservée à toi ; privilégie des indices progressifs plutôt que de la révéler d'un coup, sauf si l'étudiant demande explicitement la solution complète) :\n${context}`;
}

function openTutorChat() {
  document.getElementById('tutor-chat-panel').classList.add('on');
  document.getElementById('tutor-chat-overlay').classList.add('on');
  document.getElementById('tutor-launcher').classList.add('chat-open');
  dismissTutorBubble();
  renderTutorMessages();
  scrollTutorToBottom();
  document.getElementById('tutor-chat-input')?.focus();
}
function closeTutorChat() {
  document.getElementById('tutor-chat-panel').classList.remove('on');
  document.getElementById('tutor-chat-overlay').classList.remove('on');
  document.getElementById('tutor-launcher').classList.remove('chat-open');
}
function dismissTutorBubble() {
  document.getElementById('tutor-bubble')?.classList.add('hidden');
}

function scrollTutorToBottom() {
  const wrap = document.getElementById('tutor-chat-messages');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function renderTutorMessages() {
  const wrap = document.getElementById('tutor-chat-messages');
  if (!wrap) return;
  const welcome = `<div class="tutor-msg tutor-msg-bot"><div class="tutor-msg-bubble">Bonjour ! Je suis ton professeur virtuel : pose-moi une question sur l'exercice en cours, une notion de cours, ou tout ce qui te bloque.</div></div>`;
  const msgsHtml = tutorHistory.map(m => {
    const imgsHtml = (m.images || []).filter(a => a.previewUrl).map(a => `<img class="tutor-msg-img" src="${a.previewUrl}">`).join('');
    const textHtml = m.text ? escapeHtml(m.text).replace(/\n/g,'<br>') : '';
    return `<div class="tutor-msg tutor-msg-${m.role === 'user' ? 'user' : 'bot'}"><div class="tutor-msg-bubble">${imgsHtml}${textHtml}</div></div>`;
  }).join('');
  wrap.innerHTML = welcome + msgsHtml;
  if (window.MathJax) MathJax.typesetPromise([wrap]);
}

function startTutorLoading() {
  let i = 0;
  const el = document.getElementById('tutor-chat-load-msg');
  if (el) el.textContent = tutorMsgs[0];
  tutorMsgTimer = setInterval(() => {
    i = (i+1) % tutorMsgs.length;
    const el = document.getElementById('tutor-chat-load-msg');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = tutorMsgs[i]; el.style.opacity = '1'; }, 200);
  }, 2200);
}
function stopTutorLoading() { if (tutorMsgTimer) { clearInterval(tutorMsgTimer); tutorMsgTimer = null; } }

async function sendTutorMessage() {
  const input = document.getElementById('tutor-chat-input');
  const text = input.value.trim();
  const images = attachments['chat'] || [];
  if ((!text && !images.length) || tutorLoading) return;

  tutorHistory.push({ role: 'user', text, images: images.slice() });
  input.value = '';
  input.style.height = 'auto';
  attachments['chat'] = [];
  renderAttachThumbs('chat');
  renderTutorMessages();
  scrollTutorToBottom();

  tutorLoading = true;
  document.getElementById('tutor-chat-send').disabled = true;
  document.getElementById('tutor-chat-loading').classList.add('on');
  document.getElementById('tutor-chat-err').classList.remove('on');
  startTutorLoading();

  const historyText = tutorHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Étudiant' : 'Toi (professeur)'} : ${m.text || '[a envoyé une image]'}`
  ).join('\n');

  const prompt = `Tu es un professeur de mathématiques bienveillant et pédagogue qui discute par chat avec un étudiant de classes préparatoires (MPSI/MP). Réponds en français, de façon claire, concise et conversationnelle (quelques phrases, pas de longues listes). Si tu n'es pas sûr d'un résultat, dis-le honnêtement plutôt que d'inventer. Réponds en texte brut (pas de JSON, pas de markdown).

Notation mathématique obligatoire : toute expression mathématique, même simple (une variable, un exposant, un indice, une fraction…), doit être écrite en LaTeX, entre \\( ... \\) pour une formule dans le texte ou entre \\[ ... \\] pour une formule isolée sur sa propre ligne. N'écris jamais de mathématiques en texte brut ou avec des notations ASCII (interdits : x^2, x_n, sqrt(x), a/b, ->, INTEGRALE(...) ; écris plutôt \\(x^2\\), \\(x_n\\), \\(\\sqrt{x}\\), \\(\\frac{a}{b}\\), \\(\\to\\), \\(\\int ... \\)). Ce formatage est rendu automatiquement par MathJax : respecte-le systématiquement, y compris pour la plus petite formule.

${getCurrentContextText()}
${notationGuideText()}
${historyText ? `\nHistorique de la conversation :\n${historyText}\n` : ''}
${images.length ? `\nL'étudiant a joint ${images.length} photo(s) à son message : regarde-les attentivement.` : ''}

Nouveau message de l'étudiant : ${text || '(voir les pièces jointes)'}`;

  try {
    const reply = await callAI(prompt, images);
    const clean = reply.trim().replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'');
    tutorHistory.push({ role: 'assistant', text: clean, images: [] });
  } catch (err) {
    const el = document.getElementById('tutor-chat-err');
    el.textContent = err.message || 'Erreur inconnue';
    el.classList.add('on');
  } finally {
    stopTutorLoading();
    tutorLoading = false;
    document.getElementById('tutor-chat-send').disabled = false;
    document.getElementById('tutor-chat-loading').classList.remove('on');
    renderTutorMessages();
    scrollTutorToBottom();
  }
}

function nextProblem() {
  const list = filteredProblems();
  if (!list.length) return;
  const pos = list.indexOf(PROBLEMS[currentIdx]);
  const next = list[(pos + 1) % list.length];
  switchProblem(PROBLEMS.indexOf(next));
  window.scrollTo({top:0,behavior:'smooth'});
}
