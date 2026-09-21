# Math Arena

Application web statique d'entraînement aux mathématiques de CPGE, destinée aux niveaux MPSI, MP et MP*.

Elle regroupe des questions de cours, des exercices, des annales, une évaluation de type ELO et des outils de correction ou de tutorat assistés par IA. L'interface tient dans `index.html`; les contenus sont chargés depuis des fichiers JSON.

## Lancer le projet

Aucune installation ni compilation n'est nécessaire. Depuis la racine du dépôt :

```powershell
python -m http.server 8000
```

Ouvrir ensuite [http://localhost:8000](http://localhost:8000). Une connexion Internet reste nécessaire pour MathJax, les polices et les fonctions fournies par le Cloudflare Worker.

## Structure

- `index.html` — interface, styles et logique côté client.
- `cours/` — questions de cours et catalogue `index.json`.
- `exercices/` — exercices et catalogue `index.json`.
- `annales/` — sujets structurés et catalogue `index.json`.
- `notation-guide.json` — conventions utilisées lors de la correction de copies.
- `pdfs/annales/` — PDF d'annales suivis par Git.

## Ajouter du contenu

Créer un fichier JSON en prenant un fichier voisin comme modèle, puis ajouter son nom au `index.json` du dossier concerné. Les identifiants doivent être uniques et les chaînes LaTeX doivent respecter l'échappement JSON (`\\` pour un antislash).

Le projet ne possède actuellement ni build ni suite de tests automatisés : valider les JSON, puis effectuer un contrôle rapide dans le navigateur et sa console.
