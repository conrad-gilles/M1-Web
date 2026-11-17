# Sharing Platform

Une « watch party » : un participant ajoute un fichier audio (la vidéo arrive
en phase 3.5), partage le **code du salon**, et tout le monde lit le même média
au même instant. Lecture, pause et déplacement sont synchronisés, sans compte :
un nom d'affichage suffit.

Projet du cours Technologies Web (M1 Informatique), construit à partir de
l'application des TP. Les TP eux-mêmes restent sur la branche `main`.

## Structure

| Dossier | Contenu |
|---|---|
| `backend/` | API Node.js/Express, MongoDB (Mongoose), temps réel Socket.IO |
| `frontend/` | Application Angular 22 |
| `Documentation/` | Contrat HTTP, protocole de synchronisation, mise en place d'Atlas, usage de l'IA |

## Prérequis

- Node.js 22 ou plus récent ;
- un compte MongoDB Atlas (voir [ATLAS_SETUP.md](Documentation/ATLAS_SETUP.md)),
  ou aucun : `npm run start:memory` lance une base locale ;
- Git et un navigateur récent.

## Démarrer le backend

```bash
cd backend
cp .env.example .env
```

Renseigner dans `.env` l’URI MongoDB Atlas et le secret JWT. Ne jamais publier
ce fichier ni copier un secret dans le code Angular.

```bash
npm install
npm start              # avec MongoDB Atlas
npm run start:memory   # ou avec une base MongoDB locale, sans Atlas
```

Le backend écoute sur `http://localhost:3000`.

## Démarrer le frontend

Dans un autre terminal :

```bash
cd frontend
npm install
npm start
```

Ouvrir `http://localhost:4200`, créer un salon avec un nom d'affichage, puis
partager son code (ou son lien) pour que d'autres le rejoignent. Une session
vaut pour tout le navigateur : plusieurs onglets ouverts sur le salon sont le
même participant. Pour tester seul avec plusieurs participants, ouvrir une
fenêtre de navigation privée ou un autre navigateur.

Les fichiers de `frontend/fichiers-audio-de-test/` servent pour les essais.

## Tests

```bash
cd backend && npm test              # API, temps réel, cas d'erreur (sans MongoDB)
cd frontend && npm test             # composants et services Angular
cd frontend && npm run test:coverage   # idem, avec la couverture de code
cd e2e && npm install && npx playwright install chromium   # une seule fois
cd e2e && npm run test:full         # de bout en bout, dans de vrais navigateurs
```

Les tests de bout en bout (`e2e/`) lancent l'application complète (backend,
base MongoDB locale éphémère, build Angular) et la pilotent avec Chromium :
création et entrée dans un salon, lecture synchronisée entre deux personnes
(écart inférieur à 0,5 s), rattrapage d'un retard ou d'une avance, arrivant
tardif, onglets d'un même navigateur, actions de l'hôte, affichage sur
téléphone.

La CI GitHub Actions ([ci.yml](.github/workflows/ci.yml)) lance les trois
suites et le build Angular à chaque push.

## Documentation

- [SharingPlatformProjectClaude.md](SharingPlatformProjectClaude.md) : plan du projet, choix et état d'avancement ;
- [SharingPlatformProject.md](SharingPlatformProject.md) : notes d'origine ;
- [API_CONTRACT.md](Documentation/API_CONTRACT.md) : routes HTTP, authentification par jeton de salon, formats ;
- [SYNC_PROTOCOL.md](Documentation/SYNC_PROTOCOL.md) : canal temps réel et règles de synchronisation ;
- [ATLAS_SETUP.md](Documentation/ATLAS_SETUP.md) : créer la base MongoDB Atlas ;
- [HELP.md](HELP.md) : mémo pour lancer le projet et dépanner ;
- [RAPPORT_IA_MODELE.md](Documentation/RAPPORT_IA_MODELE.md) : modèle de compte rendu d'usage de l'IA ;
- [CONSEILS_POUR_UTILISER_ASSISTANT_AI.md](Documentation/CONSEILS_POUR_UTILISER_ASSISTANT_AI.md) : utiliser correctement un assistant IA.

Chaque sous-projet contient ses consignes pour les assistants de programmation
(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `best-practices.md`).
