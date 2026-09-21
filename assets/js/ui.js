// ── State ──────────────────────────────────────────────
let currentIdx = 0;
let filters = { domain: '', chapter: '', level: '', difficulty: '' };
let currentElo = 1200;
let evaluated = false;
let msgTimer = null;
const loadMsgs = ['Analyse en cours…','Vérification de la structure…','Évaluation de la rigueur…','Calcul du score de confiance…'];

// ── Sections (onglets) ──────────────────────────────────
let currentSection = 'exercices';

function switchSection(section) {
  currentSection = section;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === section));

  if (section === 'exercices' || section === 'cours') {
    PROBLEMS = section === 'exercices' ? EXERCICES : COURS;
    filters = { domain: '', chapter: '', level: '', difficulty: '' };
    currentIdx = 0;
    evaluated = false;
    if (PROBLEMS.length) {
      buildSelector();
      renderProblem(0);
    } else {
      document.getElementById('selector-bar').innerHTML = '';
      document.getElementById('main-content').innerHTML = '<p class="no-results-main">Aucun contenu disponible.</p>';
    }
  } else if (section === 'annales') {
    annaleFilters = { concours: '', annee: '' };
    if (ANNALES.length) {
      currentSujetId = ANNALES[0].id;
      buildAnnalesSelector();
      renderSujet(currentSujetId);
    } else {
      document.getElementById('selector-bar').innerHTML = '';
      document.getElementById('main-content').innerHTML = '<p class="no-results-main">Aucun sujet disponible.</p>';
    }
  }
  renderFiltersPanel();
  window.scrollTo({top:0, behavior:'smooth'});
}

// ── Annales de concours ─────────────────────────────────
let annaleFilters = { concours: '', annee: '' };
let currentSujetId = null;
let annaleEvaluated = {};

function filteredSujets() {
  return ANNALES.filter(s =>
    (!annaleFilters.concours || s.concours === annaleFilters.concours) &&
    (!annaleFilters.annee || String(s.annee) === annaleFilters.annee)
  );
}

function buildAnnalesSelector() {
  const concoursList = [...new Set(ANNALES.map(s => s.concours))];
  const anneesList = [...new Set(ANNALES.map(s => s.annee))].sort((a,b) => b-a);

  document.getElementById('selector-bar').innerHTML = `
    <div class="filter-row">
      <select class="filter-select" onchange="onAnnaleFilterChange('concours', this.value)">
        <option value="">Tous concours</option>
        ${concoursList.map(c => `<option value="${c}"${annaleFilters.concours===c?' selected':''}>${c}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="onAnnaleFilterChange('annee', this.value)">
        <option value="">Toutes années</option>
        ${anneesList.map(a => `<option value="${a}"${annaleFilters.annee===String(a)?' selected':''}>${a}</option>`).join('')}
      </select>
    </div>
    <div class="prob-list" id="sujet-list"></div>`;
  renderSujetList();
}

function renderSujetList() {
  const list = filteredSujets();
  const wrap = document.getElementById('sujet-list');
  if (!list.length) {
    wrap.innerHTML = `<div class="no-results">Aucun sujet ne correspond à ces filtres.</div>`;
    return;
  }
  const options = list.map(s =>
    `<option value="${s.id}"${s.id===currentSujetId?' selected':''}>${s.concours} ${s.filiere} ${s.annee} — ${s.epreuve}</option>`
  ).join('');
  wrap.innerHTML = `
    <div class="prob-picker">
      <select class="filter-select prob-select" onchange="switchSujet(this.value)">${options}</select>
      <span class="prob-count">${list.length} sujet${list.length>1?'s':''}</span>
    </div>`;
}

function onAnnaleFilterChange(key, value) {
  annaleFilters[key] = value;
  const list = filteredSujets();
  if (list.length) {
    if (!list.some(s => s.id === currentSujetId)) currentSujetId = list[0].id;
    buildAnnalesSelector();
    renderSujet(currentSujetId);
  } else {
    buildAnnalesSelector();
    document.getElementById('main-content').innerHTML = '<p class="no-results-main">Aucun sujet ne correspond à ces filtres.</p>';
  }
}

function switchSujet(id) {
  currentSujetId = id;
  buildAnnalesSelector();
  renderSujet(id);
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function questionContextText(sujet, qid) {
  const parts = [];
  for (const b of sujet.blocks) {
    if (b.type === 'heading') parts.push(b.title);
    else if (b.type === 'text') parts.push(stripHtml(b.html));
    else if (b.type === 'question') {
      let s = `${b.id}. ${b.statement}`;
      if (b.formula) s += ` ${b.formula}`;
      if (b.followup) s += ` ${b.followup}`;
      parts.push(s);
      if (b.id === qid) break;
    }
  }
  return parts.join('\n');
}

function renderQuestionBlockHTML(sujetId, b) {
  const attachKey = sujetId + '-' + b.id;
  return `
    <div class="qblock" id="qblock-${b.id}">
      <div class="q-head">${b.id}.</div>
      <div class="q-statement">${b.statement}</div>
      ${b.formula ? `<div class="math-block">\\[${b.formula}\\]</div>` : ''}
      ${b.followup ? `<div class="q-statement">${b.followup}</div>` : ''}
      <textarea class="answer-textarea" placeholder="Votre réponse…"></textarea>
      ${attachRowHTML(attachKey)}
      <div class="loading-bar q-loading">
        <div class="spinner"></div>
        <span class="load-msg">Analyse en cours…</span>
      </div>
      <div class="q-foot">
        <div class="char-count">0 caractère</div>
        <button class="btn-val" onclick="validateAnnaleAnswer('${sujetId}','${b.id}')">Valider la réponse</button>
      </div>
      <div class="scores-panel">
        <div class="sc-head"><h2>Résultat</h2><div class="verdict">—</div></div>
        <div class="sc-grid"></div>
        <div class="feedback-wrap">
          <div class="fb-label">Retour détaillé</div>
          <div class="fb-text">…</div>
        </div>
        <div class="err-msg"></div>
        <button class="btn-retry" style="display:none" onclick="retryAnnaleEval('${sujetId}','${b.id}')">Relancer l'évaluation</button>
      </div>
    </div>`;
}

function renderSujet(id) {
  const sujet = ANNALES.find(s => s.id === id);
  if (!sujet) return;
  document.getElementById('hdr-cat').textContent = `${sujet.concours} ${sujet.filiere} ${sujet.annee}`;

  let body = '';
  sujet.blocks.forEach(b => {
    if (b.type === 'heading') body += `<h3 class="ann-heading ann-h${b.level}">${b.title}</h3>`;
    else if (b.type === 'text') body += `<div class="ann-text">${b.html}</div>`;
    else if (b.type === 'question') body += renderQuestionBlockHTML(sujet.id, b);
  });

  document.getElementById('main-content').innerHTML = `
    <div class="meta-row">
      <div class="tag">${sujet.concours} · ${sujet.filiere} · ${sujet.annee}</div>
      <div class="diff-row">${sujet.epreuve}${sujet.duree ? ' · ' + sujet.duree : ''}</div>
    </div>
    <div class="problem-card">
      <div class="prob-head"><div class="prob-title">${sujet.epreuve}</div></div>
      <div class="prob-body">${body}</div>
    </div>`;

  document.querySelectorAll('.qblock').forEach(qb => {
    const ta = qb.querySelector('.answer-textarea');
    const ccEl = qb.querySelector('.char-count');
    ta.addEventListener('input', () => {
      const n = ta.value.length;
      ccEl.textContent = n + ' caractère' + (n>1?'s':'');
    });
  });

  sujet.blocks.filter(b => b.type === 'question').forEach(b => renderAttachThumbs(sujet.id + '-' + b.id));

  if (window.MathJax) MathJax.typesetPromise();
}

async function validateAnnaleAnswer(sujetId, qid) {
  const key = sujetId + '::' + qid;
  const block = document.getElementById('qblock-' + qid);
  if (!block) return;
  const answer = block.querySelector('.answer-textarea').value.trim();
  const attachKey = sujetId + '-' + qid;
  const images = attachments[attachKey] || [];
  if ((answer.length < 10 && !images.length) || annaleEvaluated[key]) return;

  annaleEvaluated[key] = true;
  const btn = block.querySelector('.btn-val');
  btn.disabled = true;
  btn.textContent = 'Évaluation…';
  block.querySelector('.q-loading').classList.add('on');
  block.querySelector('.scores-panel').classList.remove('on');
  block.querySelector('.err-msg').classList.remove('on');

  const sujet = ANNALES.find(s => s.id === sujetId);
  const context = questionContextText(sujet, qid);
  const prompt = `Tu es un correcteur expert en mathématiques de classes préparatoires (${sujet.filiere}), corrigeant une épreuve de concours (${sujet.concours} ${sujet.annee}, ${sujet.epreuve}).

Contexte de l'épreuve jusqu'à la question ${qid} incluse :
${context}
${notationGuideText()}

Évalue la réponse ci-dessous à la question ${qid} uniquement. Réponds UNIQUEMENT avec un objet JSON valide contenant exactement ces champs :
{
  "correctness": <entier 0-100, justesse mathématique>,
  "correctness_comment": <string 1-2 phrases>,
  "completeness": <entier 0-100, complétude>,
  "completeness_comment": <string 1-2 phrases>,
  "rigor": <entier 0-100, rigueur des justifications>,
  "rigor_comment": <string 1-2 phrases>,
  "clarity": <entier 0-100, clarté de rédaction>,
  "clarity_comment": <string 1-2 phrases>,
  "confidence": <entier 0-100, certitude de l'évaluation>,
  "feedback": <string 3-5 phrases constructives en français>
}
${images.length ? `\nL'étudiant a également joint ${images.length} photo(s)/document(s) de sa réponse manuscrite : lis-les attentivement et évalue leur contenu.` : ''}

Réponse de l'étudiant à la question ${qid} :
${answer || '(voir les pièces jointes)'}`;

  try {
    const text = await callAI(prompt, images);
    let raw = text.trim().replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s===-1||e===-1) throw new Error('Aucun JSON dans la réponse');
    raw = raw.slice(s, e+1);
    const result = JSON.parse(raw);
    if (typeof result.correctness !== 'number') throw new Error('Champs manquants');

    block.querySelector('.q-loading').classList.remove('on');
    renderAnnaleScores(block, result);
    btn.textContent = 'Évalué ✓';

  } catch(err) {
    block.querySelector('.q-loading').classList.remove('on');
    const el = block.querySelector('.err-msg');
    el.textContent = err.message || 'Erreur inconnue';
    el.classList.add('on');
    block.querySelector('.scores-panel').classList.add('on');
    block.querySelector('.btn-retry').style.display = 'inline-block';
    annaleEvaluated[key] = false;
    btn.disabled = false;
    btn.textContent = 'Valider la réponse';
  }
}

function renderAnnaleScores(block, data) {
  const dims = [
    {key:'correctness',label:'Correction mathématique'},
    {key:'completeness',label:'Complétude'},
    {key:'rigor',label:'Rigueur & formalisme'},
    {key:'clarity',label:'Clarté de rédaction'},
  ];
  const grid = block.querySelector('.sc-grid');
  grid.innerHTML = dims.map(d => {
    const s = data[d.key]??0;
    return `<div class="sc-item">
      <div class="sc-label">${d.label}</div>
      <div class="sc-bar-row">
        <div class="sc-track"><div class="sc-fill ${fc(s)}" data-bar="${d.key}"></div></div>
        <div class="sc-val ${cc(s)}">${s}</div>
      </div>
      <div class="sc-comment">${data[d.key+'_comment']||''}</div>
    </div>`;
  }).join('');

  const conf = data.confidence??50;
  grid.innerHTML += `<div class="conf-row">
    <div class="conf-label">Confiance IA</div>
    <div class="conf-track"><div class="conf-fill" data-bar="conf"></div></div>
    <div class="conf-pct">${conf}%</div>
    <div class="conf-note">non calibré</div>
  </div>`;

  requestAnimationFrame(() => {
    dims.forEach((d,i) => {
      const el = grid.querySelector(`[data-bar="${d.key}"]`);
      setTimeout(() => { if (el) el.style.width = (data[d.key]??0) + '%'; }, 80+i*120);
    });
    const confEl = grid.querySelector('[data-bar="conf"]');
    setTimeout(() => { if (confEl) confEl.style.width = conf + '%'; }, 560);
  });

  const overall = Math.round(dims.reduce((a,d)=>a+(data[d.key]??0),0)/4);
  const vEl = block.querySelector('.verdict');
  if (overall>=70){vEl.textContent='Correct';vEl.className='verdict ok';}
  else if(overall>=40){vEl.textContent='Partiel';vEl.className='verdict mid';}
  else{vEl.textContent='Insuffisant';vEl.className='verdict bad';}

  block.querySelector('.fb-text').textContent = data.feedback||'';
  block.querySelector('.scores-panel').classList.add('on');
  if (window.MathJax) MathJax.typesetPromise();
}

function retryAnnaleEval(sujetId, qid) {
  const key = sujetId + '::' + qid;
  annaleEvaluated[key] = false;
  const block = document.getElementById('qblock-' + qid);
  block.querySelector('.err-msg').classList.remove('on');
  block.querySelector('.btn-retry').style.display = 'none';
  validateAnnaleAnswer(sujetId, qid);
}

// ── Render ─────────────────────────────────────────────
function renderProblem(idx) {
  const p = PROBLEMS[idx];
  attachments['answer'] = [];
  const chap = chapterInfo(p.chapter);
  document.getElementById('hdr-cat').textContent = `${p.domain} · ${chap ? chap.name : '—'}`;
  const maxDifficulty = Math.max(...DIFFICULTIES.map(d => d.value));
  const difficultyLabel = DIFFICULTIES.find(d => d.value === p.difficulty)?.label || '';
  const dots = Array.from({length:maxDifficulty},(_,i)=>`<div class="dot${i<p.difficulty?' on':''}"></div>`).join('');

  document.getElementById('main-content').innerHTML = `
    <div class="meta-row">
      <div class="tag">Problème #${String(idx+1).padStart(3,'0')}</div>
      <div class="diff-row">Difficulté <div class="dots">${dots}</div> niveau ${p.difficulty}/${maxDifficulty}${difficultyLabel ? ` · ${difficultyLabel}` : ''}</div>
    </div>
    <div class="cat-row">
      <span class="cat-tag">${p.domain}</span>
      <span class="cat-tag">Chap. ${p.chapter} — ${chap ? chap.name : '—'}</span>
      <span class="cat-tag cat-level">${p.level}</span>
    </div>
    <div class="problem-card">
      <div class="prob-head">
        <div class="prob-title">${p.title}</div>
        <div class="cadence">${p.cadence}</div>
      </div>
      <div class="prob-body">
        <p>${p.statement}</p>
        ${p.formula ? `<div class="math-block">\\[${p.formula}\\]</div>` : ''}
        ${p.followup ? `<p>${p.followup}</p>` : ''}
        ${p.questions?.length ? `<ol class="q-list">${p.questions.map(q=>`<li>${q}</li>`).join('')}</ol>` : ''}
        ${p.remark ? `<p class="remark">${p.remark}</p>` : ''}
      </div>
      ${p.hint ? `<button class="btn-hint" id="btn-hint" onclick="toggleHint()"><span>⚑</span><span>Afficher l'indication</span></button>
      <div class="hint-box" id="hint-box"><span>⚑</span><span>Indication : ${p.hint}</span></div>` : ''}
      ${p.correction ? `<button class="btn-correction" id="btn-correction" onclick="toggleCorrection()"><span>📖</span><span>Afficher la correction</span></button>
      <div class="correction-box" id="correction-box">
        <div class="correction-label">Correction</div>
        <div class="correction-text">${p.correction}</div>
      </div>` : ''}
    </div>
    <div class="answer-card">
      <div class="ans-head"><b>Votre démonstration</b><span>Rédigez librement — LaTeX accepté</span></div>
      <textarea id="answer" placeholder="Écrivez votre preuve ici…"></textarea>
      ${attachRowHTML('answer')}
      <div class="loading-bar" id="loading-bar">
        <div class="spinner"></div>
        <span class="load-msg" id="load-msg">Analyse en cours…</span>
      </div>
      <div class="ans-foot">
        <div class="char-count" id="char-count">0 caractères</div>
        <button class="btn-val" id="btn-val" onclick="validateAnswer()">Valider la réponse</button>
      </div>
    </div>
    <div class="scores-panel" id="scores-panel">
      <div class="sc-head"><h2>Résultats de l'évaluation</h2><div style="display:flex;align-items:center;gap:10px"><span class="eval-badge" id="eval-badge"></span><div class="verdict" id="verdict">—</div></div></div>
      <div class="eval-meta" id="eval-meta"></div>
      <div class="sc-grid" id="sc-grid"></div>
      <div class="feedback-wrap">
        <div class="fb-label">Retour détaillé</div>
        <div class="fb-text" id="fb-text">…</div>
      </div>
      <div class="elo-row">
        <span>Variation ELO</span>
        <span class="elo-delta" id="elo-delta">+0</span>
        <span>→ nouveau score : <b id="new-elo">${currentElo}</b></span>
      </div>
      <div class="err-msg" id="err-msg"></div>
      <button class="btn-retry" id="btn-retry" onclick="retryEval()">Relancer l'évaluation</button>
      <div class="new-prob-wrap"><button class="btn-new" onclick="nextProblem()">Problème suivant →</button></div>
    </div>`;

  document.getElementById('answer').addEventListener('input', () => {
    const n = document.getElementById('answer').value.length;
    document.getElementById('char-count').textContent = n + ' caractère' + (n>1?'s':'');
  });
  if (window.MathJax) MathJax.typesetPromise();
  updateQuotaBanner();
}

function toggleHint() {
  document.getElementById('hint-box').classList.add('on');
  document.getElementById('btn-hint').style.display = 'none';
}

function toggleCorrection() {
  document.getElementById('correction-box').classList.add('on');
  document.getElementById('btn-correction').style.display = 'none';
  if (window.MathJax) MathJax.typesetPromise();
}
