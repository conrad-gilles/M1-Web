# Sharing Platform

Une « watch party » : un participant ajoute un fichier audio ou vidéo,
partage le **code du salon**, et tout le monde lit le même média au même
instant. Lecture, pause et déplacement sont synchronisés, sans compte :
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

### Stockage des médias (Backblaze B2)

Avec les cinq variables `S3_*` dans `.env` (voir `.env.example`), les fichiers
vont dans le bucket privé Backblaze B2 ; sans elles, sur le disque local
(`backend/data/uploads`), ce qui suffit pour développer hors ligne. Les tests
utilisent toujours le disque local.

```bash
npm run check:storage   # aller-retour réel avec le bucket : envoi, lecture, Range, CORS, suppression
npm run setup:cors      # une fois : règle CORS du bucket (lecture seule, origines de l'app)
```

Le navigateur lit les fichiers directement depuis B2 avec une URL présignée.
Attention : en développement avec `.env`, les essais consomment le même quota
gratuit que la production (10 Go stockés, 1 Go de lecture par jour). Sur
Render, ajouter les cinq variables `S3_*` dans *Environment*.

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

Les fichiers de `frontend/fichiers-audio-de-test/` servent pour les essais, et
les courtes vidéos de `e2e/fixtures/` (MP4, MKV, AVI, son silencieux) pour la vidéo.

### Langues : français et anglais

L'interface existe en français et en anglais. À la première visite, elle suit
la langue du navigateur (français si c'est le français, anglais sinon) ; les
boutons **FR / EN** de l'en-tête la changent aussitôt, et le choix est retenu.
Les messages d'erreur du serveur, rédigés en français, sont traduits à
l'affichage. Tous les textes sont dans
`frontend/src/app/shared/i18n/translations.ts`.

### Synchroniser des fichiers locaux (sans les envoyer)

À côté de l'upload, la carte **« Synchroniser un fichier local »** ajoute au
salon un média dont le fichier n'est jamais envoyé : seuls son titre, sa durée
et son type partent au serveur. Quand il est lu, le lecteur du salon demande à
chaque participant de choisir **sa propre copie** ; elle est acceptée si sa
**durée est la même à 1 s près** (le nom, la taille et le format peuvent
différer). La lecture passe ensuite par le même lecteur et la même
synchronisation que les fichiers envoyés. Aucun stockage ni quota de
téléchargement n'est consommé. Après un rechargement de la page, le navigateur
demande de rechoisir le fichier (il ne peut pas le rouvrir seul), et le format
doit être lisible par le navigateur (pas de conversion pour les fichiers
locaux).

### Formats acceptés

| Type | Formats | Limite |
|---|---|---|
| Audio | MP3, WAV, OGG, M4A | Aucune ; avertissement à partir de 1 Go |
| Vidéo | MP4, WebM, OGV | Aucune ; avertissement à partir de 1 Go |
| Vidéo convertie | MOV, AVI, MKV | Aucune ; avertissement au-delà de 200 Mo (conversion sur l'appareil) et à partir de 1 Go |

Il n'y a pas de limite de taille par fichier : la limite est le stockage
gratuit. Quand il est plein, l'envoi échoue avec un message clair (erreur
`507`). Quand le quota gratuit de lecture du jour est atteint (1 Go par jour
avec Backblaze B2), le lecteur le dit au lieu d'une erreur générique.

Les MOV, AVI et MKV sont convertis en MP4 **dans le navigateur** de la personne
qui les envoie (`ffmpeg.wasm`), puis envoyés comme un MP4. Le convertisseur
(~32 Mo) n'est téléchargé que la première fois qu'il sert.

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
téléphone, vidéo (lecteur `<video>` synchronisé, conversion des MKV et AVI dans
le navigateur), fichiers locaux synchronisés (chacun sa copie, refus d'une
durée différente). Le son des navigateurs de test est coupé.

La CI GitHub Actions ([ci.yml](.github/workflows/ci.yml)) lance les trois
suites et le build Angular à chaque push.

### Bloquer un push qui casse les tests

GitHub ne peut pas refuser un push : la CI tourne après. Le hook
[.githooks/pre-push](.githooks/pre-push) lance donc, avant chaque `git push`,
les tests du backend, ceux du frontend et le build Angular (~25 s), et annule le
push si l'un échoue. Les tests de bout en bout restent dans la CI. À activer une
fois par clone :

```bash
git config core.hooksPath .githooks
```

En cas d'urgence, `git push --no-verify` passe outre.

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
