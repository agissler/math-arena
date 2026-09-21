// ── Taxonomie chargée depuis data/taxonomy.json ─────────
let CHAPTERS = [];
let LEVELS = [];
function chapterInfo(n) { return CHAPTERS.find(c => c.n === Number(n)); }

function fullStatementText(p) {
  const parts = [p.statement];
  if (p.formula) parts.push(`Formule : ${p.formula}`);
  if (p.followup) parts.push(p.followup);
  if (p.questions?.length) parts.push(p.questions.map((q,i) => `${i+1}. ${q}`).join('\n'));
  if (p.remark) parts.push(p.remark);
  return parts.join('\n\n');
}

// ── Contenu chargé depuis data/ ─────────────────────────
// Pour ajouter un problème : crée data/<dossier>/<id>.json (avec domain,
// chapter, level, difficulty) puis ajoute son nom dans data/<dossier>/index.json.
let EXERCICES = [];
let COURS = [];
let ANNALES = [];
let PROBLEMS = []; // liste active pour les sections 'exercices' et 'cours'

async function loadProblemSet(folder) {
  const idxRes = await fetch(`${folder}/index.json`);
  if (!idxRes.ok) throw new Error(`Impossible de charger ${folder}/index.json (HTTP ${idxRes.status})`);
  const files = await idxRes.json();
  return Promise.all(files.map(async f => {
    const res = await fetch(`${folder}/${f}`);
    if (!res.ok) throw new Error(`Impossible de charger ${folder}/${f} (HTTP ${res.status})`);
    return res.json();
  }));
}

let NOTATION_GUIDE = null;

async function loadAllContent() {
  const [taxonomy, exercices, cours, annales, notationGuide] = await Promise.all([
    fetch('data/taxonomy.json').then(r => {
      if (!r.ok) throw new Error(`Impossible de charger data/taxonomy.json (HTTP ${r.status})`);
      return r.json();
    }),
    loadProblemSet('data/exercices'),
    loadProblemSet('data/cours'),
    loadProblemSet('data/annales'),
    fetch('data/notation-guide.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  if (!Array.isArray(taxonomy.chapters) || !Array.isArray(taxonomy.levels) || !Array.isArray(taxonomy.cadences)) {
    throw new Error('Taxonomie invalide : "chapters", "levels" et "cadences" doivent être des tableaux.');
  }

  CHAPTERS = taxonomy.chapters;
  LEVELS = taxonomy.levels;
  EXERCICES = exercices;
  COURS = cours;
  ANNALES = annales;
  NOTATION_GUIDE = notationGuide;
  randomFilters = loadRandomFilters();
  PROBLEMS = EXERCICES;
}
// Construit un bloc d'instructions à partir de data/notation-guide.json, pour aider
// l'IA à interpréter les notations mathématiques (en particulier sur une photo
// manuscrite) sans pénaliser des variations de forme sans conséquence sur le sens.
function notationGuideText() {
  if (!NOTATION_GUIDE) return '';
  const equiv = (NOTATION_GUIDE.equivalent_notations || [])
    .map(e => `- ${e.meaning} : ${e.forms.join(' / ')}`).join('\n');
  const ambig = (NOTATION_GUIDE.handwriting_ambiguities || [])
    .map(a => `- ${a}`).join('\n');
  return `\n\nGuide d'interprétation des notations mathématiques : ${NOTATION_GUIDE.grading_instruction}\n\nNotations équivalentes (à ne jamais traiter comme incohérentes entre elles) :\n${equiv}\n\nAmbiguïtés fréquentes de l'écriture manuscrite :\n${ambig}`;
}
