// ── Appel Gemini via worker ────────────────────────────
async function callAI(prompt, images) {
  if (!WORKER_URL) throw new Error('URL du worker non configurée.');
  const body = { ...(await buildAuthBody()), prompt };
  if (selectedModel) body.model = selectedModel;
  if (images && images.length) {
    body.images = images.map(a => ({ mimeType: a.mimeType, data: a.base64 }));
  }
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.status === 401) throw new Error('Session expirée — rechargez la page.');
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  if (!data.text) throw new Error('Réponse vide du worker');
  return data.text;
}

// Évaluation d'une démonstration : le worker construit lui-même le barème
// détaillé et le pipeline de double évaluation à partir de gradingContext
// (la solution de référence), pour ne jamais exposer ces éléments côté client.
async function callGrading(prompt, gradingContext, images) {
  if (!WORKER_URL) throw new Error('URL du worker non configurée.');
  const body = { ...(await buildAuthBody()), prompt, grading_context: gradingContext };
  if (selectedModel) body.model = selectedModel;
  if (images && images.length) {
    body.images = images.map(a => ({ mimeType: a.mimeType, data: a.base64 }));
  }
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.status === 401) throw new Error('Session expirée — rechargez la page.');
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  if (typeof data.correctness !== 'number') throw new Error('Réponse d\'évaluation invalide');
  return data;
}

// ── Sélecteur de modèle (Gemini/Groq) & quotas estimés ─
// Le catalogue vient de GET /models (public, sans mot de passe). Les quotas
// sont une ESTIMATION côté client (compteur localStorage), pas une source de
// vérité : le serveur reste seul juge du quota réel auprès des providers.
const QUOTA_KEY = 'ma_quotas';
let MODEL_CATALOG_CLIENT = {};
let DEFAULT_ORDER_CLIENT = [];
let selectedModel = null;

function workerModelsUrl() {
  return WORKER_URL.endsWith('/') ? WORKER_URL + 'models' : WORKER_URL + '/models';
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function loadQuotas() {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveQuotas() {
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify(quotas)); } catch {}
}
let quotas = loadQuotas();

function usedToday(model) {
  const entry = quotas[model];
  if (!entry || entry.date !== todayStr()) return 0;
  return entry.used;
}
function bumpQuota(model) {
  if (!model) return;
  const today = todayStr();
  const entry = quotas[model];
  quotas[model] = (!entry || entry.date !== today) ? { used: 1, date: today } : { used: entry.used + 1, date: today };
  saveQuotas();
}
function remaining(model) {
  const info = MODEL_CATALOG_CLIENT[model];
  if (!info) return 0;
  return Math.max(0, info.rpd - usedToday(model));
}
function allQuotasExhausted() {
  const keys = Object.keys(MODEL_CATALOG_CLIENT);
  return keys.length > 0 && keys.every(m => remaining(m) <= 0);
}

// Trie par remaining décroissant, puis par quality décroissant en cas d'égalité.
function selectDefaultModel() {
  const keys = Object.keys(MODEL_CATALOG_CLIENT);
  if (!keys.length) return null;
  const ranked = [...keys].sort((a, b) => {
    const diff = remaining(b) - remaining(a);
    if (diff !== 0) return diff;
    return (MODEL_CATALOG_CLIENT[b].quality || 0) - (MODEL_CATALOG_CLIENT[a].quality || 0);
  });
  return ranked[0];
}

async function loadModelCatalog() {
  try {
    const res = await fetch(workerModelsUrl());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let models = data.models || {};
    let order = Array.isArray(data.default_order) ? data.default_order.filter(m => models[m]) : Object.keys(models);

    // En mode Google, seuls les modèles Gemini sont utilisables (l'utilisateur
    // n'a pas de clé Groq personnelle) : le catalogue est filtré côté client
    // avant même le calcul du modèle par défaut, pour que selectDefaultModel()
    // et le dropdown ne voient jamais que des modèles Gemini dans ce mode.
    if (sessionStorage.getItem('auth_mode') === 'google') {
      order = order.filter(m => models[m]?.provider === 'gemini');
      models = Object.fromEntries(order.map(m => [m, models[m]]));
    }

    MODEL_CATALOG_CLIENT = models;
    DEFAULT_ORDER_CLIENT = order;
  } catch (e) {
    console.error('Impossible de charger le catalogue de modèles', e);
    MODEL_CATALOG_CLIENT = {};
    DEFAULT_ORDER_CLIENT = [];
  }
  selectedModel = selectDefaultModel();
  renderModelSelector();
  updateQuotaBanner();
}

function renderModelSelector() {
  const wrap = document.getElementById('model-select-wrap');
  if (!wrap) return;
  const keys = DEFAULT_ORDER_CLIENT.length ? DEFAULT_ORDER_CLIENT : Object.keys(MODEL_CATALOG_CLIENT);
  if (!keys.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  if (!selectedModel || !MODEL_CATALOG_CLIENT[selectedModel]) selectedModel = keys[0];
  const info = MODEL_CATALOG_CLIENT[selectedModel];

  document.getElementById('model-select-label').textContent = `🤖 ${info.label}`;
  document.getElementById('model-remaining').textContent = `${remaining(selectedModel)} restants`;

  const dd = document.getElementById('model-dropdown');
  dd.innerHTML = `
    <div class="model-dropdown-note">Quotas estimés (côté client)</div>
    ${keys.map(k => {
      const m = MODEL_CATALOG_CLIENT[k];
      const rem = remaining(k);
      return `<button type="button" class="model-option${k === selectedModel ? ' active' : ''}" onclick="chooseModel('${k}')">
        <span class="model-option-label">${m.label}</span>
        <span class="model-option-meta">${rem} restants (est.) · qualité ${m.quality}/3</span>
      </button>`;
    }).join('')}
  `;
}

function chooseModel(key) {
  selectedModel = key;
  closeModelDropdown();
  renderModelSelector();
}

function toggleModelDropdown(e) {
  e?.stopPropagation();
  document.getElementById('model-dropdown')?.classList.toggle('on');
}
function closeModelDropdown() {
  document.getElementById('model-dropdown')?.classList.remove('on');
}

function updateQuotaBanner() {
  const exhausted = allQuotasExhausted();
  document.getElementById('quota-banner')?.classList.toggle('on', exhausted);
  const btn = document.getElementById('btn-val');
  if (btn) btn.disabled = exhausted || evaluated;
}

// ── Pièces jointes (photo de réponse manuscrite) ───────
const MAX_ATTACH_DIM = 1600;
const MAX_ATTACHMENTS = 6;
let attachments = {};
let cameraStream = null;
let cameraTargetKey = null;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_ATTACH_DIM || height > MAX_ATTACH_DIM) {
        const scale = MAX_ATTACH_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function addFiles(key, fileList) {
  attachments[key] = attachments[key] || [];
  const room = MAX_ATTACHMENTS - attachments[key].length;
  const files = Array.from(fileList).slice(0, Math.max(0, room));
  for (const file of files) {
    try {
      let dataUrl, mimeType, previewUrl;
      if (file.type.startsWith('image/')) {
        const raw = await readAsDataURL(file);
        dataUrl = await resizeImageDataUrl(raw);
        mimeType = 'image/jpeg';
        previewUrl = dataUrl;
      } else {
        dataUrl = await readAsDataURL(file);
        mimeType = file.type || 'application/pdf';
        previewUrl = null;
      }
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      attachments[key].push({ name: file.name, mimeType, base64, previewUrl });
    } catch (e) {
      console.error('Erreur de lecture du fichier', e);
    }
  }
  renderAttachThumbs(key);
}

function handleFileInput(key, fileList) {
  addFiles(key, fileList);
}

function removeAttachment(key, idx) {
  attachments[key]?.splice(idx, 1);
  renderAttachThumbs(key);
}

function renderAttachThumbs(key) {
  const wrap = document.getElementById('attach-thumbs-' + key);
  if (!wrap) return;
  const list = attachments[key] || [];
  wrap.innerHTML = list.map((a, i) => `
    <div class="attach-thumb">
      ${a.previewUrl ? `<img src="${a.previewUrl}" alt="${a.name}">` : `<div class="attach-file-chip" title="${a.name}">📄</div>`}
      <button class="attach-remove" onclick="removeAttachment('${key}', ${i})" title="Retirer">×</button>
    </div>`).join('');
}

function triggerFilePick(key) {
  document.getElementById('file-input-' + key)?.click();
}

async function triggerCamera(key) {
  cameraTargetKey = key;
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.getElementById('camera-video');
      video.srcObject = cameraStream;
      document.getElementById('camera-modal').classList.add('on');
      return;
    } catch (e) {
      // Permission refusée / pas de caméra détectée par getUserMedia : on retombe sur l'input natif.
    }
  }
  document.getElementById('camera-input-' + key)?.click();
}

function closeCameraModal() {
  document.getElementById('camera-modal').classList.remove('on');
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    addFiles(cameraTargetKey, [file]);
    closeCameraModal();
  }, 'image/jpeg', 0.9);
}

function attachRowHTML(key) {
  return `
    <div class="attach-row">
      <button type="button" class="btn-attach" onclick="triggerFilePick('${key}')" title="Joindre une image ou un PDF">📎</button>
      <button type="button" class="btn-attach" onclick="triggerCamera('${key}')" title="Prendre une photo">📷</button>
      <div class="attach-thumbs" id="attach-thumbs-${key}"></div>
      <input type="file" id="file-input-${key}" accept="image/*,application/pdf" multiple style="display:none" onchange="handleFileInput('${key}', this.files)">
      <input type="file" id="camera-input-${key}" accept="image/*" capture="environment" style="display:none" onchange="handleFileInput('${key}', this.files)">
    </div>`;
}

// ── Loading ────────────────────────────────────────────
function startLoading() {
  let i = 0;
  const el = document.getElementById('load-msg');
  if (el) el.textContent = loadMsgs[0];
  msgTimer = setInterval(() => {
    i = (i+1) % loadMsgs.length;
    const el = document.getElementById('load-msg');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = loadMsgs[i]; el.style.opacity = '1'; }, 200);
  }, 2200);
}
function stopLoading() { if (msgTimer) { clearInterval(msgTimer); msgTimer = null; } }

// ── Scores ─────────────────────────────────────────────
function cc(s){return s>=70?'g':s>=40?'m':'r';}
function fc(s){return s>=70?'fill-g':s>=40?'fill-m':'fill-r';}
function animBar(id,pct,delay){setTimeout(()=>{const el=document.getElementById(id);if(el)el.style.width=pct+'%';},delay||0);}

function renderScores(data) {
  const dims = [
    {key:'correctness',label:'Correction mathématique'},
    {key:'completeness',label:'Complétude'},
    {key:'rigor',label:'Rigueur & formalisme'},
    {key:'clarity',label:'Clarté de rédaction'},
  ];
  const grid = document.getElementById('sc-grid');
  grid.innerHTML = dims.map(d => {
    const s = data[d.key]??0;
    return `<div class="sc-item">
      <div class="sc-label">${d.label}</div>
      <div class="sc-bar-row">
        <div class="sc-track"><div class="sc-fill ${fc(s)}" id="bar-${d.key}"></div></div>
        <div class="sc-val ${cc(s)}">${s}</div>
      </div>
      <div class="sc-comment">${data[d.key+'_comment']||''}</div>
    </div>`;
  }).join('');

  const conf = data.confidence??50;
  grid.innerHTML += `<div class="conf-row">
    <div class="conf-label">Confiance IA</div>
    <div class="conf-track"><div class="conf-fill" id="bar-conf"></div></div>
    <div class="conf-pct">${conf}%</div>
    <div class="conf-note">non calibré</div>
  </div>`;

  requestAnimationFrame(() => {
    dims.forEach((d,i) => animBar('bar-'+d.key, data[d.key]??0, 80+i*120));
    animBar('bar-conf', conf, 560);
  });

  const overall = Math.round(dims.reduce((a,d)=>a+(data[d.key]??0),0)/4);
  const vEl = document.getElementById('verdict');
  if (overall>=70){vEl.textContent='Correct';vEl.className='verdict ok';}
  else if(overall>=40){vEl.textContent='Partiel';vEl.className='verdict mid';}
  else{vEl.textContent='Insuffisant';vEl.className='verdict bad';}

  const badgeEl = document.getElementById('eval-badge');
  if (badgeEl) {
    badgeEl.textContent = data.evaluation_count === 2 ? '🔁 Double évaluation' : '🔍 Évaluation simple';
    badgeEl.title = data.evaluation_count === 2
      ? (data.meta_used ? 'Deux relectures indépendantes, synthétisées par l\'IA' : 'Deux relectures indépendantes, notes réconciliées')
      : 'Une seule relecture (scores cohérents et confiance suffisante)';
  }

  const metaEl = document.getElementById('eval-meta');
  if (metaEl) {
    const modelInfo = MODEL_CATALOG_CLIENT[data.model_used];
    const modelLabel = modelInfo ? modelInfo.label : (data.model_used || 'modèle inconnu');
    const evalType = data.evaluation_count === 2 ? 'Double évaluation' : 'Évaluation simple';
    metaEl.textContent = `Évalué par : ${modelLabel} • ${evalType} • Confiance : ${data.confidence}%`;
  }

  document.getElementById('fb-text').textContent = data.feedback||'';

  const delta = data.elo_delta??0;
  currentElo += delta;
  const eEl = document.getElementById('elo-delta');
  eEl.textContent = (delta>=0?'+':'')+delta;
  eEl.className = 'elo-delta'+(delta<0?' neg':'');
  document.getElementById('new-elo').textContent = currentElo;
  document.getElementById('elo-display').textContent = currentElo;
}

// ── Validate ───────────────────────────────────────────
async function validateAnswer() {
  const answer = document.getElementById('answer')?.value?.trim() || '';
  const images = attachments['answer'] || [];
  if ((answer.length < 20 && !images.length) || evaluated || allQuotasExhausted()) return;

  evaluated = true;
  const btn = document.getElementById('btn-val');
  btn.disabled = true;
  btn.textContent = 'Évaluation…';
  document.getElementById('loading-bar').classList.add('on');
  document.getElementById('scores-panel').classList.remove('on');
  document.getElementById('err-msg').classList.remove('on');
  startLoading();

  const p = PROBLEMS[currentIdx];
  const gradingContext = p.correction || p.grading_context;
  const prompt = `Énoncé : ${fullStatementText(p)}
${notationGuideText()}
${images.length ? `\nL'étudiant a également joint ${images.length} photo(s)/document(s) de sa démonstration manuscrite : lis-les attentivement et évalue leur contenu.` : ''}

Démonstration à évaluer :
${answer || '(voir les pièces jointes)'}`;

  try {
    const result = await callGrading(prompt, gradingContext, images);
    bumpQuota(result.model_used);
    renderModelSelector();

    stopLoading();
    document.getElementById('loading-bar').classList.remove('on');
    document.getElementById('scores-panel').classList.add('on');
    renderScores(result);
    btn.textContent = 'Évalué ✓';
    updateQuotaBanner();

  } catch(err) {
    stopLoading();
    document.getElementById('loading-bar').classList.remove('on');
    const el = document.getElementById('err-msg');
    el.textContent = err.message || 'Erreur inconnue';
    el.classList.add('on');
    document.getElementById('scores-panel').classList.add('on');
    document.getElementById('btn-retry').style.display = 'inline-block';
    evaluated = false;
    btn.disabled = false;
    btn.textContent = 'Valider la réponse';
  }
}

function retryEval() {
  evaluated = false;
  document.getElementById('err-msg').classList.remove('on');
  document.getElementById('btn-retry').style.display = 'none';
  validateAnswer();
}
