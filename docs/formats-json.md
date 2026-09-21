# Formats JSON

Les fichiers chargés par l'application se trouvent sous `data/`. Chaque sous-dossier de contenu possède un `index.json` qui liste exactement les fichiers à charger.

## Cours et exercices

Champs obligatoires :

- `id`, identique au nom du fichier sans `.json` ;
- `title`, `domain`, `level`, `cadence` et `statement` ;
- `chapter`, numéro déclaré dans `data/taxonomy.json` ;
- `difficulty`, entier de 1 à 5.

`level` et `cadence` doivent correspondre exactement à des valeurs déclarées dans `data/taxonomy.json`.

Champs optionnels : `formula`, `followup`, `questions`, `remark`, `hint`, `grading_context`, `correction` et `tags`.

```json
{
  "id": "exemple-001",
  "title": "Titre court",
  "domain": "Analyse",
  "chapter": 5,
  "level": "MPSI",
  "cadence": "Standard · 20 min",
  "difficulty": 3,
  "statement": "Énoncé avec \\(x_n\\)."
}
```

## Annales

Une annale contient `id`, `concours`, `filiere`, `annee`, `epreuve`, `duree` et `blocks`. Les blocs autorisés sont :

- `text` avec `html` ;
- `heading` avec `level` et `title` ;
- `question` avec `id`, `statement`, et éventuellement `formula` ou `followup`.

## Vérification

```powershell
node scripts/validate-content.mjs
node tests/content/validate-content.test.mjs
```

Les schémas de référence sont dans `schemas/`. Le validateur contrôle également les index, les fichiers orphelins, les identifiants et la cohérence avec la taxonomie.
