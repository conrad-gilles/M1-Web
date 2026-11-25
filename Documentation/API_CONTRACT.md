# Contrat HTTP

Base : `/api`. Il n'y a **pas de comptes** : l'accès repose sur le code d'un
salon. Créer ou rejoindre un salon renvoie un **jeton de salon**, à envoyer
ensuite dans `Authorization: Bearer <jeton>`.

La lecture synchronisée passe par un WebSocket (Socket.IO), authentifié par le
même jeton de salon : voir [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md).

MongoDB conserve les salons et les métadonnées des médias ; les octets des
fichiers sont confiés au module de stockage du backend (`backend/src/storage/` :
Backblaze B2 quand les variables `S3_*` sont renseignées, disque local sinon).
Un **média local** n'a aucun fichier côté serveur : chaque participant lit sa
propre copie.

## Routes

| Méthode | Route | Authentification | Requête | Réponse principale |
|---|---|---|---|---|
| GET | `/health` | - | - | `200 { "status": "ok" }` |
| POST | `/rooms` | - | `{name}` | `201 RoomAccess` (avec `hostToken`) |
| POST | `/rooms/:code/join` | - | `{name}` | `200 RoomAccess` |
| GET | `/rooms/current` | jeton de salon | - | `200 Room` |
| POST | `/rooms/current/leave` | jeton de salon | - | `204` |
| POST | `/rooms/current/code` | jeton de salon + `X-Host-Token` | - | `200 Room` (nouveau code) |
| DELETE | `/rooms/current` | jeton de salon + `X-Host-Token` | - | `204` |
| GET | `/media?page=1&limit=5` | jeton de salon | - | `200 Page<Media>` |
| POST | `/media` | jeton de salon | multipart : `file`, `title`, `folder?` | `201 Media` |
| POST | `/media/local` | jeton de salon | JSON : `{title, duration, kind, originalName?, mimeType?, size?}` | `201 Media` (`source: "local"`) |
| POST | `/media/p2p` | jeton de salon | JSON : comme `/media/local` | `201 Media` (`source: "p2p"`, `owner` : le participant du jeton) |
| POST | `/media/local-folder` | jeton de salon | JSON : `{folder, items: [{originalName, duration, kind, title?, mimeType?, size?}]}` | `201 Media[]` |
| GET | `/media/folder?name=…` | jeton de salon | - | `200 Media[]` (médias du dossier, triés par chemin) |
| GET | `/media/:id/download` | jeton de salon | - | `200 { url, expiresAt }` : URL de téléchargement (pièce jointe nommée) |
| GET | `/media/:id/url` | jeton de salon | - | `200 MediaUrl` |
| GET | `/media/:id/stream?token=…` | jeton de l'URL | en-tête `Range` facultatif | `200` ou `206`, octets du média |
| DELETE | `/media/:id` | jeton de salon | - | `204` |

`/rooms/current` désigne toujours le salon du jeton : un jeton ne donne accès
qu'à son propre salon et à ses médias.

## Formats

- `Participant` : `{ id, name }`.
- `Room` : `{ code, participants, expiresAt }`. `code` compte 6 caractères parmi
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sans `0/O`, `1/I/L`) ; la saisie n'est pas
  sensible à la casse. `expiresAt` recule à chaque activité.
- `RoomAccess` : `{ room, participant, token, hostToken? }`. `token` est le jeton
  de salon (JWT, valable 24 h). `hostToken` n'est renvoyé qu'au créateur ; il
  n'est jamais stocké en clair côté serveur et se transmet dans l'en-tête
  `X-Host-Token`.
- `name` : nom d'affichage, 1 à 30 caractères après suppression des espaces
  autour.
- `Media` : `{ id, source, duration, folder, owner, kind, title, originalName, mimeType, size, createdAt }`,
  `owner` : `{ id, name }` du participant qui partage un média `source: "p2p"`
  (partage direct entre navigateurs, voir SYNC_PROTOCOL.md), sinon `null` ;
  `/media/:id/url` renvoie `url: null` et `/media/:id/download` `409` pour un
  média p2p,
  `folder` : nom du dossier d'origine (envoi ou synchronisation d'un dossier),
  ou `null` ; pour un dossier local, `originalName` est le chemin du fichier
  dans ce dossier (`"Saison 1/ep01.mkv"`),
  avec `kind` égal à `"audio"` ou `"video"` et `source` égal à :
  - `"upload"` : fichier envoyé et stocké ; `duration` vaut `null` ;
  - `"local"` : rien n'est envoyé (`POST /media/local`). `duration` (secondes)
    est la durée du fichier de celui qui l'a ajouté. À la lecture, chaque
    participant choisit sa propre copie ; le navigateur l'accepte si sa durée
    est la même **à 1 s près** (nom, taille et format peuvent différer).
    `size`, `originalName` et `mimeType` décrivent le fichier d'origine, à
    titre indicatif.
- `POST /media/local` : `title` 1 à 200 caractères, `duration` nombre de
  secondes strictement positif, `kind` `"audio"` ou `"video"`.
- `POST /media/local-folder` : `folder` 1 à 200 caractères, 1 à 1 000 fichiers
  par requête, mêmes règles que `/media/local` pour chacun, `originalName`
  (chemin dans le dossier) obligatoire. Tout est vérifié avant d'enregistrer
  quoi que ce soit. Un autre participant relie son dossier de même nom : les
  fichiers de même chemin et de même durée (1 s près) deviennent lisibles
  pour lui ; il déclare les fichiers que le salon n'a pas encore.
- `GET /media/:id/download` : comme `/media/:id/url`, mais le navigateur
  enregistre le fichier sous son nom d'origine (`Content-Disposition:
  attachment`). Avec B2, chaque téléchargement compte dans le quota gratuit
  du jour (1 Go). `409` pour un média local (aucun fichier sur le serveur).
- **Pas de nombre maximal de médias par salon** : la limite est l'espace du
  stockage gratuit (`507` quand il est plein). Corps JSON : 1 Mo au plus.
- `Page<Media>` : `{ items, page, limit, total, pages }`. `page` vaut au moins 1,
  `limit` est compris entre 1 et 20 (5 par défaut).
- `MediaUrl` : `{ url, expiresAt, media }`. `url` est une URL temporaire limitée
  à ce média (6 h par défaut, variable `MEDIA_URL_TTL_SECONDS`), à placer
  directement dans `<audio src>` ou `<video src>`. `media` est le `Media`
  correspondant. Pour un média local, `url` et `expiresAt` valent `null` : le
  lecteur demande au participant de choisir sa copie.
- Formats acceptés à l'upload, **sans limite de taille par fichier** (la limite
  est l'espace de stockage : voir l'erreur `507`) :
  - audio (`kind: "audio"`) : MP3, WAV, OGG et M4A ;
  - vidéo (`kind: "video"`) : MP4 (`video/mp4`), WebM (`video/webm`) et OGV
    (`video/ogg`).
  `kind` est déduit du type MIME par le serveur ; le client s'en sert pour
  afficher un lecteur `<audio>` ou `<video>`. Les vidéos MOV, AVI et MKV ne
  sont pas acceptées par l'API : le frontend les convertit d'abord en MP4 dans
  le navigateur (FFmpeg WebAssembly) et envoie le résultat, nommé `*.mp4`.

## Règles des salons

- **Accès.** Connaître le code suffit pour entrer. Tout participant peut
  ajouter, lire et supprimer les médias du salon.
- **Hôte.** Le créateur peut changer le code (l'ancien cesse de fonctionner, les
  jetons déjà émis restent valides) et fermer le salon (ses médias et leurs
  fichiers sont supprimés).
- **Quitter.** `POST /rooms/current/leave` invalide aussitôt le jeton du
  participant.
- **Expiration.** Un salon inactif depuis 24 h (variable `ROOM_TTL_HOURS`) est
  refusé puis supprimé avec ses fichiers.
- **Limites.** 10 participants par salon (quand le salon est plein, les
  participants entrés depuis plus de 2 minutes et non connectés au WebSocket
  cèdent leur place), pas de nombre maximal de médias. Par adresse IP :
  10 codes erronés par tranche de 10 minutes, 10 créations de salon par heure.

## Lecture en streaming

1. `GET /media/:id/url` vérifie le jeton de salon et l'appartenance du média au
   salon, puis renvoie une URL signée :
   - **Backblaze B2** (variables `S3_*` renseignées) : URL présignée absolue
     du bucket privé (`https://<bucket>.s3.<région>.backblazeb2.com/…`),
     valable 6 h (7 jours au plus) ;
   - **disque local** (sinon) : `/api/media/:id/stream?token=…`, servie par le
     backend.
2. Le lecteur charge cette URL sans en-tête `Authorization`. B2 ou le backend
   répond aux requêtes `Range` par `206 Partial Content` (`Accept-Ranges: bytes`,
   `Content-Range`) : la lecture démarre avant la fin du téléchargement et le
   déplacement dans le média fonctionne. Avec B2, le fichier ne passe jamais
   par le backend.
3. Le jeton est porté par la chaîne de requête ; les logs HTTP du backend la
   remplacent par `?[masqué]`.
4. Quand le lecteur échoue, le frontend relit le statut de l'URL (requête
   `Range: bytes=0-0`) pour afficher la cause : `403` quota gratuit de lecture
   du jour atteint (réponse de Backblaze B2), `401` lien expiré, `404` média
   supprimé.

## Erreurs

Toutes les erreurs ont la forme `{ "message": "…" }`.

| Statut | Cas |
|---|---|
| `400` | `Titre requis (200 caractères maximum)`, `Durée du média requise (nombre de secondes positif)`, `Type de média requis : audio ou video` (`POST /media/local`), `Nom du dossier requis (200 caractères maximum)`, `Liste de fichiers requise (1000 au plus par envoi)`, `Chemin du fichier requis dans le dossier` (`POST /media/local-folder`, `GET /media/folder`), `Corps JSON invalide`, `Nom d'affichage requis (30 caractères maximum)`, `Fichier requis`, `Format de média non accepté` |
| `401` | `Jeton de salon requis` (en-tête absent), `Salon fermé ou jeton invalide` (jeton falsifié ou expiré, salon fermé ou expiré, participant sorti), `Lien de lecture invalide ou expiré` (route `/stream`) |
| `403` | `Action réservée à l'hôte du salon` (`X-Host-Token` absent ou faux) |
| `404` | `Salon inconnu` (mauvais code à l'entrée), `Média inconnu` (inexistant, appartenant à un autre salon, ou identifiant invalide), `Ressource inconnue` (route `/api` inexistante) |
| `409` | `Salon complet`, `Média local : aucun fichier à télécharger sur le serveur` |
| `429` | `Trop de tentatives, réessayez plus tard` (codes erronés), `Trop de salons créés, réessayez plus tard` |
| `507` | `Espace de stockage gratuit épuisé : supprimez des médias du salon ou réessayez plus tard.` (`POST /media` : disque plein, ou quota du stockage atteint) |
| `500` | `Erreur interne du serveur` (erreur inattendue, détail dans les logs uniquement), `Métadonnée supprimée, mais fichier non supprimé` (`DELETE /media/:id`) |
