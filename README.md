# Math Arena

Application web statique d'entraînement aux mathématiques, destinée aux niveaux Terminale, MPSI, MP et MP*.

Elle regroupe des questions de cours, des exercices, des annales, une évaluation ELO et des outils de correction ou de tutorat assistés par IA.

## Lancer le projet

Aucune installation ni compilation n'est nécessaire. Depuis la racine du dépôt :

```powershell
python -m http.server 8000
```

Ouvrir ensuite [http://localhost:8000](http://localhost:8000). Une connexion Internet reste nécessaire pour MathJax, les polices et les fonctions fournies par le Cloudflare Worker.

## Structure

- `index.html` — structure de la page.
- `assets/` — styles et logique JavaScript côté client.
- `data/` — taxonomie, guide de notation et contenus JSON indexés.
- `schemas/` — formats JSON de référence.
- `scripts/` et `tests/` — validation automatique des contenus.
- `docs/` — documentation des formats JSON.
- `.github/workflows/` — validation exécutée par GitHub.

## Ajouter du contenu

Créer le JSON dans le sous-dossier approprié de `data/`, puis ajouter son nom au `index.json` concerné. Le format complet est décrit dans `docs/formats-json.md`.

```powershell
node scripts/validate-content.mjs
node tests/content/validate-content.test.mjs
```

Il n'existe aucune étape de build : après validation, effectuer un contrôle rapide dans le navigateur et sa console.
