// ── Filtres & sélecteur ─────────────────────────────────
function filteredProblems() {
  return PROBLEMS.filter(p =>
    (!filters.domain || p.domain === filters.domain) &&
    (!filters.chapter || String(p.chapter) === filters.chapter) &&
    (!filters.level || p.level === filters.level) &&
    (!filters.difficulty || String(p.difficulty) === filters.difficulty)
  );
}

function buildSelector() {
  const domains = [...new Set(CHAPTERS.map(c => c.domain))];
  const chapterOpts = CHAPTERS
    .filter(c => !filters.domain || c.domain === filters.domain)
    .map(c => `<option value="${c.n}"${filters.chapter===String(c.n)?' selected':''}>${c.n}. ${c.name}</option>`)
    .join('');

  document.getElementById('selector-bar').innerHTML = `
    <div class="filter-row">
      <select class="filter-select" onchange="onFilterChange('domain', this.value)">
        <option value="">Toutes matières</option>
        ${domains.map(d => `<option value="${d}"${filters.domain===d?' selected':''}>${d}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="onFilterChange('chapter', this.value)">
        <option value="">Tous chapitres</option>
        ${chapterOpts}
      </select>
      <select class="filter-select" onchange="onFilterChange('level', this.value)">
        <option value="">Tous niveaux</option>
        ${LEVELS.map(l => `<option value="${l}"${filters.level===l?' selected':''}>${l}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="onFilterChange('difficulty', this.value)">
        <option value="">Toutes difficultés</option>
        ${[1,2,3,4,5].map(d => `<option value="${d}"${filters.difficulty===String(d)?' selected':''}>Niveau ${d}/5</option>`).join('')}
      </select>
    </div>
    <div class="prob-list" id="prob-list"></div>`;

  renderProbList();
}

function renderProbList() {
  const list = filteredProblems();
  const wrap = document.getElementById('prob-list');
  if (!list.length) {
    wrap.innerHTML = `<div class="no-results">Aucun problème ne correspond à ces filtres.</div>`;
    return;
  }
  const options = list.map(p => {
    const idx = PROBLEMS.indexOf(p);
    return `<option value="${idx}"${idx===currentIdx?' selected':''}>#${String(idx+1).padStart(3,'0')} — ${p.title}</option>`;
  }).join('');
  wrap.innerHTML = `
    <div class="prob-picker">
      <select class="filter-select prob-select" onchange="switchProblem(Number(this.value))">${options}</select>
      <span class="prob-count">${list.length} exercice${list.length>1?'s':''}</span>
    </div>`;
}

function onFilterChange(key, value) {
  filters[key] = value;
  if (key === 'domain' && value && filters.chapter && chapterInfo(filters.chapter)?.domain !== value) {
    filters.chapter = '';
  }
  const list = filteredProblems();
  if (list.length) {
    if (!list.includes(PROBLEMS[currentIdx])) {
      currentIdx = PROBLEMS.indexOf(list[0]);
      evaluated = false;
    }
    buildSelector();
    renderProblem(currentIdx);
  } else {
    buildSelector();
    document.getElementById('main-content').innerHTML = `<p style="font-family:var(--mono);color:var(--muted);padding:24px 0">Aucun problème ne correspond à ces filtres.</p>`;
  }
}

function switchProblem(idx) {
  currentIdx = idx;
  evaluated = false;
  buildSelector();
  renderProblem(idx);
}

// ── Sélection aléatoire avec filtres ────────────────────
// Système indépendant de l'ancien sélecteur manuel ci-dessus : ses propres
// filtres (randomFilters), persistés dans localStorage, pilotent le bouton
// « Problème aléatoire ». N'affecte ni filters/filteredProblems ni la logique
// d'évaluation.
const RANDOM_FILTERS_KEY = 'ma_filters';
const CADENCE_BUCKETS = [
  { key: 'bullet',   label: 'Bullet (< 5 min)' },
  { key: 'blitz',    label: 'Blitz (10 min)' },
  { key: 'marathon', label: 'Marathon (20 min+)' },
];
// Les libellés de cadence existants ("Blitz · 10/15 min", "Standard · 15/20 min",
// "Marathon · 20-35 min") ne correspondent pas exactement aux 3 paliers demandés :
// on bucket donc sur la durée en minutes plutôt que sur le mot-clé, pour que
// chaque problème retombe dans exactement un palier (seuils à 5 et 20 min).
function cadenceBucket(cadenceStr) {
  const m = /(\d+)/.exec(cadenceStr || '');
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  if (mins < 5) return 'bullet';
  if (mins < 20) return 'blitz';
  return 'marathon';
}

function defaultRandomFilters() {
  return { levels: [], diffMin: 1, diffMax: 5, domain: '', cadences: [], tags: [] };
}

function loadRandomFilters() {
  try {
    const raw = localStorage.getItem(RANDOM_FILTERS_KEY);
    if (!raw) return defaultRandomFilters();
    const parsed = JSON.parse(raw);
    const clamp5 = (n, fallback) => Number.isInteger(n) ? Math.min(Math.max(n, 1), 5) : fallback;
    return {
      levels: Array.isArray(parsed.levels) ? parsed.levels.filter(l => LEVELS.includes(l)) : [],
      diffMin: clamp5(parsed.diffMin, 1),
      diffMax: clamp5(parsed.diffMax, 5),
      domain: typeof parsed.domain === 'string' ? parsed.domain : '',
      cadences: Array.isArray(parsed.cadences) ? parsed.cadences.filter(c => CADENCE_BUCKETS.some(b => b.key === c)) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(t => typeof t === 'string') : [],
    };
  } catch { return defaultRandomFilters(); }
}

function saveRandomFilters() {
  try { localStorage.setItem(RANDOM_FILTERS_KEY, JSON.stringify(randomFilters)); } catch {}
}

// Initialisé avec les valeurs persistées après le chargement de la taxonomie.
let randomFilters = defaultRandomFilters();
let filtersPanelOpen = true; // état d'accordéon (n'a d'effet visuel qu'en mobile)

function getAllTags() {
  const set = new Set();
  PROBLEMS.forEach(p => (p.tags || []).forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

function getFilteredProblems() {
  return PROBLEMS.filter(p => {
    if (randomFilters.levels.length && !randomFilters.levels.includes(p.level)) return false;
    if (p.difficulty < randomFilters.diffMin || p.difficulty > randomFilters.diffMax) return false;
    if (randomFilters.domain && p.domain !== randomFilters.domain) return false;
    if (randomFilters.cadences.length) {
      const bucket = cadenceBucket(p.cadence);
      if (!bucket || !randomFilters.cadences.includes(bucket)) return false;
    }
    if (randomFilters.tags.length) {
      const tags = p.tags || [];
      if (!randomFilters.tags.some(t => tags.includes(t))) return false;
    }
    return true;
  });
}

function updateFiltersAvailability() {
  const el = document.getElementById('filters-avail');
  if (!el) return;
  const n = getFilteredProblems().length;
  el.textContent = n > 0 ? `${n} problème${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}` : 'Aucun résultat';
  el.style.color = n > 0 ? 'var(--accent)' : 'var(--danger)';
}

function toggleFiltersPanel() {
  filtersPanelOpen = !filtersPanelOpen;
  document.querySelector('#filters-panel .filters-panel-box')?.classList.toggle('open', filtersPanelOpen);
}

function toggleLevelFilter(level) {
  const i = randomFilters.levels.indexOf(level);
  if (i === -1) randomFilters.levels.push(level); else randomFilters.levels.splice(i, 1);
  saveRandomFilters();
  renderFiltersPanel();
}

function toggleCadenceFilter(key) {
  const i = randomFilters.cadences.indexOf(key);
  if (i === -1) randomFilters.cadences.push(key); else randomFilters.cadences.splice(i, 1);
  saveRandomFilters();
  renderFiltersPanel();
}

function toggleTagFilter(tag) {
  const i = randomFilters.tags.indexOf(tag);
  if (i === -1) randomFilters.tags.push(tag); else randomFilters.tags.splice(i, 1);
  saveRandomFilters();
  renderFiltersPanel();
}

function onCategoryFilterChange(value) {
  randomFilters.domain = value;
  saveRandomFilters();
  renderFiltersPanel();
}

// Les deux curseurs sont mis à jour en place (jamais de ré-affichage complet
// du panneau pendant le glisser), pour ne pas interrompre le geste de l'utilisateur.
function onDiffRangeInput(which, value) {
  value = Number(value);
  const minInput = document.getElementById('diff-min-input');
  const maxInput = document.getElementById('diff-max-input');
  if (which === 'min') {
    if (value > randomFilters.diffMax) { randomFilters.diffMax = value; if (maxInput) maxInput.value = value; }
    randomFilters.diffMin = value;
  } else {
    if (value < randomFilters.diffMin) { randomFilters.diffMin = value; if (minInput) minInput.value = value; }
    randomFilters.diffMax = value;
  }
  const label = document.getElementById('diff-range-label');
  if (label) label.textContent = `${randomFilters.diffMin} – ${randomFilters.diffMax}`;
  saveRandomFilters();
  updateFiltersAvailability();
}

function resetRandomFilters() {
  randomFilters = defaultRandomFilters();
  saveRandomFilters();
  renderFiltersPanel();
}

function renderFiltersPanel() {
  const panel = document.getElementById('filters-panel');
  if (!panel) return;

  if (currentSection !== 'exercices' && currentSection !== 'cours') {
    panel.innerHTML = '';
    return;
  }

  const domains = ['Analyse', 'Algèbre', 'Probabilités', 'Géométrie'];
  const tags = getAllTags();

  panel.innerHTML = `
    <div class="filters-panel-box">
      <div class="filters-toggle-row" onclick="toggleFiltersPanel()">
        <span class="filters-title">🎯 Filtres &amp; sélection aléatoire</span>
        <span class="filters-avail" id="filters-avail"></span>
        <span class="filters-chevron">▾</span>
      </div>
      <div class="filters-body">
        <div class="filter-block">
          <div class="filter-block-label">Niveau</div>
          <div class="toggle-group">
            ${LEVELS.map(l => `<button type="button" class="toggle-chip${randomFilters.levels.includes(l) ? ' on' : ''}" onclick="toggleLevelFilter('${l}')">${l}</button>`).join('')}
          </div>
        </div>

        <div class="filter-block">
          <div class="filter-block-label">Difficulté <span class="filter-block-value" id="diff-range-label">${randomFilters.diffMin} – ${randomFilters.diffMax}</span></div>
          <div class="range-slider-wrap">
            <input type="range" min="1" max="5" step="1" value="${randomFilters.diffMin}" id="diff-min-input" oninput="onDiffRangeInput('min', this.value)">
            <input type="range" min="1" max="5" step="1" value="${randomFilters.diffMax}" id="diff-max-input" oninput="onDiffRangeInput('max', this.value)">
          </div>
        </div>

        <div class="filter-block">
          <div class="filter-block-label">Catégorie</div>
          <select class="filter-select" onchange="onCategoryFilterChange(this.value)">
            <option value="">Toutes</option>
            ${domains.map(d => `<option value="${d}"${randomFilters.domain === d ? ' selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>

        <div class="filter-block">
          <div class="filter-block-label">Cadence</div>
          <div class="toggle-group">
            ${CADENCE_BUCKETS.map(c => `<button type="button" class="toggle-chip${randomFilters.cadences.includes(c.key) ? ' on' : ''}" onclick="toggleCadenceFilter('${c.key}')">${c.label}</button>`).join('')}
          </div>
        </div>

        ${tags.length ? `
        <div class="filter-block">
          <div class="filter-block-label">Tags</div>
          <div class="chip-group">
            ${tags.map(t => `<button type="button" class="toggle-chip${randomFilters.tags.includes(t) ? ' on' : ''}" onclick="toggleTagFilter('${t.replace(/'/g, "\\'")}')">${t}</button>`).join('')}
          </div>
        </div>` : ''}
      </div>
      <div class="filters-actions">
        <button type="button" class="btn-random" onclick="pickRandom()">🎲 Problème aléatoire</button>
        <button type="button" class="btn-reset-filters" onclick="resetRandomFilters()">Réinitialiser les filtres</button>
      </div>
      <div class="random-msg" id="random-msg"></div>
    </div>`;

  panel.querySelector('.filters-panel-box').classList.toggle('open', filtersPanelOpen);
  updateFiltersAvailability();
}

function pickRandom() {
  const list = getFilteredProblems();
  const msgEl = document.getElementById('random-msg');

  if (!list.length) {
    if (msgEl) { msgEl.textContent = 'Aucun problème ne correspond à ces filtres.'; msgEl.classList.add('on'); }
    return;
  }
  if (msgEl) msgEl.classList.remove('on');

  // Exclut le problème actuellement affiché si d'autres options existent.
  const currentP = PROBLEMS[currentIdx];
  const candidates = list.length > 1 ? (list.filter(p => p !== currentP).length ? list.filter(p => p !== currentP) : list) : list;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const idx = PROBLEMS.indexOf(chosen);

  const applyChoice = () => {
    currentIdx = idx;
    evaluated = false;
    buildSelector();
    renderProblem(idx);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (list.length === 1) {
    applyChoice(); // un seul problème disponible : affichage direct, sans animation
    return;
  }

  const bar = document.getElementById('selector-bar');
  bar?.classList.add('flash-accent');
  setTimeout(() => { bar?.classList.remove('flash-accent'); applyChoice(); }, 260);
}
