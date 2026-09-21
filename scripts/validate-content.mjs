import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const PROBLEM_FIELDS = new Set([
  'id', 'title', 'domain', 'chapter', 'level', 'cadence', 'difficulty',
  'statement', 'formula', 'followup', 'questions', 'remark', 'hint',
  'grading_context', 'correction', 'tags',
]);
const PROBLEM_REQUIRED_STRINGS = ['id', 'title', 'domain', 'level', 'cadence', 'statement'];
const PROBLEM_OPTIONAL_STRINGS = ['formula', 'followup', 'remark', 'hint', 'grading_context', 'correction'];

function display(root, file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function readJson(root, file, issues) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    issues.push(`${display(root, file)} : JSON invalide (${error.message})`);
    return null;
  }
}

function requireNonEmptyString(value, label, issues) {
  if (typeof value !== 'string' || value.trim() === '') issues.push(`${label} doit être une chaîne non vide`);
}

function checkKnownFields(object, allowed, label, issues) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) issues.push(`${label} : champ inconnu "${key}"`);
  }
}

function validateIndexedFolder(root, folder, issues) {
  const indexFile = path.join(folder, 'index.json');
  const index = readJson(root, indexFile, issues);
  if (!Array.isArray(index)) {
    issues.push(`${display(root, indexFile)} doit contenir un tableau`);
    return [];
  }

  const seen = new Set();
  for (const name of index) {
    if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.json')) {
      issues.push(`${display(root, indexFile)} : entrée invalide "${name}"`);
      continue;
    }
    if (seen.has(name)) issues.push(`${display(root, indexFile)} : doublon "${name}"`);
    seen.add(name);
    if (!fs.existsSync(path.join(folder, name))) issues.push(`${display(root, indexFile)} : fichier absent "${name}"`);
  }

  const actual = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
    .map(entry => entry.name);
  for (const name of actual) {
    if (!seen.has(name)) issues.push(`${display(root, folder)} : fichier non indexé "${name}"`);
  }
  return index.filter(name => typeof name === 'string' && fs.existsSync(path.join(folder, name)));
}

function validateProblem(root, file, item, taxonomy, ids, issues) {
  const label = display(root, file);
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    issues.push(`${label} doit contenir un objet`);
    return;
  }
  checkKnownFields(item, PROBLEM_FIELDS, label, issues);
  for (const field of PROBLEM_REQUIRED_STRINGS) requireNonEmptyString(item[field], `${label}.${field}`, issues);
  for (const field of PROBLEM_OPTIONAL_STRINGS) {
    if (field in item && typeof item[field] !== 'string') issues.push(`${label}.${field} doit être une chaîne`);
  }
  if (!Number.isInteger(item.chapter)) issues.push(`${label}.chapter doit être un entier`);
  if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
    issues.push(`${label}.difficulty doit être un entier entre 1 et 5`);
  }
  for (const field of ['questions', 'tags']) {
    if (field in item && (!Array.isArray(item[field]) || item[field].some(value => typeof value !== 'string'))) {
      issues.push(`${label}.${field} doit être un tableau de chaînes`);
    }
  }
  if (typeof item.id === 'string' && path.basename(file, '.json') !== item.id) {
    issues.push(`${label} : le nom du fichier doit être ${item.id}.json`);
  }
  if (ids.has(item.id)) issues.push(`${label} : identifiant dupliqué "${item.id}"`);
  ids.add(item.id);
  if (!taxonomy.levels.includes(item.level)) issues.push(`${label} : niveau inconnu "${item.level}"`);
  const chapter = taxonomy.chapters.find(entry => entry.n === item.chapter);
  if (!chapter) issues.push(`${label} : chapitre inconnu "${item.chapter}"`);
  else if (chapter.domain !== item.domain) issues.push(`${label} : domaine "${item.domain}" incompatible avec le chapitre ${item.chapter}`);
}

function validateAnnale(root, file, item, ids, issues) {
  const label = display(root, file);
  const allowed = new Set(['id', 'concours', 'filiere', 'annee', 'epreuve', 'duree', 'blocks']);
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    issues.push(`${label} doit contenir un objet`);
    return;
  }
  checkKnownFields(item, allowed, label, issues);
  for (const field of ['id', 'concours', 'filiere', 'epreuve', 'duree']) requireNonEmptyString(item[field], `${label}.${field}`, issues);
  if (!Number.isInteger(item.annee)) issues.push(`${label}.annee doit être un entier`);
  if (typeof item.id === 'string' && path.basename(file, '.json') !== item.id) issues.push(`${label} : nom de fichier différent de l'id`);
  if (ids.has(item.id)) issues.push(`${label} : identifiant d'annale dupliqué "${item.id}"`);
  ids.add(item.id);
  if (!Array.isArray(item.blocks) || item.blocks.length === 0) {
    issues.push(`${label}.blocks doit être un tableau non vide`);
    return;
  }
  const questionIds = new Set();
  item.blocks.forEach((block, index) => {
    const blockLabel = `${label}.blocks[${index}]`;
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      issues.push(`${blockLabel} doit être un objet`);
      return;
    }
    if (block.type === 'text') {
      checkKnownFields(block, new Set(['type', 'html']), blockLabel, issues);
      requireNonEmptyString(block.html, `${blockLabel}.html`, issues);
    } else if (block.type === 'heading') {
      checkKnownFields(block, new Set(['type', 'level', 'title']), blockLabel, issues);
      if (!Number.isInteger(block.level) || block.level < 1 || block.level > 6) issues.push(`${blockLabel}.level doit être compris entre 1 et 6`);
      requireNonEmptyString(block.title, `${blockLabel}.title`, issues);
    } else if (block.type === 'question') {
      checkKnownFields(block, new Set(['type', 'id', 'statement', 'formula', 'followup']), blockLabel, issues);
      requireNonEmptyString(block.id, `${blockLabel}.id`, issues);
      requireNonEmptyString(block.statement, `${blockLabel}.statement`, issues);
      for (const field of ['formula', 'followup']) {
        if (field in block && typeof block[field] !== 'string') issues.push(`${blockLabel}.${field} doit être une chaîne`);
      }
      if (questionIds.has(block.id)) issues.push(`${blockLabel} : identifiant de question dupliqué "${block.id}"`);
      questionIds.add(block.id);
    } else {
      issues.push(`${blockLabel} : type inconnu "${block.type}"`);
    }
  });
}

function validateTaxonomy(root, issues) {
  const file = path.join(root, 'Data', 'taxonomy.json');
  const taxonomy = readJson(root, file, issues);
  if (!taxonomy || !Array.isArray(taxonomy.levels) || !Array.isArray(taxonomy.chapters)) {
    issues.push('Data/taxonomy.json doit définir les tableaux levels et chapters');
    return { levels: [], chapters: [] };
  }
  const levels = new Set();
  taxonomy.levels.forEach((level, index) => {
    requireNonEmptyString(level, `Data/taxonomy.json.levels[${index}]`, issues);
    if (levels.has(level)) issues.push(`Data/taxonomy.json : niveau dupliqué "${level}"`);
    levels.add(level);
  });
  const chapters = new Set();
  taxonomy.chapters.forEach((chapter, index) => {
    const label = `Data/taxonomy.json.chapters[${index}]`;
    if (!Number.isInteger(chapter?.n) || chapter.n < 1) issues.push(`${label}.n doit être un entier positif`);
    requireNonEmptyString(chapter?.name, `${label}.name`, issues);
    requireNonEmptyString(chapter?.domain, `${label}.domain`, issues);
    if (chapters.has(chapter?.n)) issues.push(`Data/taxonomy.json : chapitre dupliqué "${chapter?.n}"`);
    chapters.add(chapter?.n);
  });
  return taxonomy;
}

function validateNotationGuide(root, issues) {
  const file = path.join(root, 'Data', 'notation-guide.json');
  const guide = readJson(root, file, issues);
  if (!guide) return;
  requireNonEmptyString(guide.grading_instruction, 'Data/notation-guide.json.grading_instruction', issues);
  if (!Array.isArray(guide.equivalent_notations)) issues.push('Data/notation-guide.json.equivalent_notations doit être un tableau');
  else guide.equivalent_notations.forEach((entry, index) => {
    requireNonEmptyString(entry?.meaning, `Data/notation-guide.json.equivalent_notations[${index}].meaning`, issues);
    if (!Array.isArray(entry?.forms) || entry.forms.some(form => typeof form !== 'string')) {
      issues.push(`Data/notation-guide.json.equivalent_notations[${index}].forms doit être un tableau de chaînes`);
    }
  });
  if (!Array.isArray(guide.handwriting_ambiguities) || guide.handwriting_ambiguities.some(value => typeof value !== 'string')) {
    issues.push('Data/notation-guide.json.handwriting_ambiguities doit être un tableau de chaînes');
  }
}

export function validateRepository(root = DEFAULT_ROOT) {
  const issues = [];
  for (const name of fs.readdirSync(path.join(root, 'schemas'))) {
    if (name.endsWith('.json')) readJson(root, path.join(root, 'schemas', name), issues);
  }
  const taxonomy = validateTaxonomy(root, issues);
  validateNotationGuide(root, issues);
  const problemIds = new Set();
  for (const kind of ['cours', 'exercices']) {
    const folder = path.join(root, 'Data', kind);
    for (const name of validateIndexedFolder(root, folder, issues)) {
      const file = path.join(folder, name);
      validateProblem(root, file, readJson(root, file, issues), taxonomy, problemIds, issues);
    }
  }
  const annaleIds = new Set();
  const annalesFolder = path.join(root, 'Data', 'annales');
  for (const name of validateIndexedFolder(root, annalesFolder, issues)) {
    const file = path.join(annalesFolder, name);
    validateAnnale(root, file, readJson(root, file, issues), annaleIds, issues);
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const issues = validateRepository();
  if (issues.length) {
    console.error(`Validation échouée (${issues.length} problème${issues.length > 1 ? 's' : ''}) :`);
    issues.forEach(issue => console.error(`- ${issue}`));
    process.exitCode = 1;
  } else {
    console.log('Validation réussie : taxonomie, guide, catalogues et contenus JSON sont cohérents.');
  }
}
