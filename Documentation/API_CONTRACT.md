# Contrat HTTP

Base : `/api`. Il n'y a **pas de comptes** : l'accès repose sur le code d'un
salon. Créer ou rejoindre un salon renvoie un **jeton de salon**, à envoyer
ensuite dans `Authorization: Bearer <jeton>`.

MongoDB conserve les salons et les métadonnées des médias ; les octets des
fichiers sont confiés au module de stockage du backend (`backend/src/storage/`,
disque local pour l'instant).

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
| POST | `/media` | jeton de salon | multipart : `file`, `title` | `201 Media` |
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
- `Media` : `{ id, kind, title, originalName, mimeType, size, createdAt }`, avec
  `kind` égal à `"audio"` ou `"video"`.
- `Page<Media>` : `{ items, page, limit, total, pages }`. `page` vaut au moins 1,
  `limit` est compris entre 1 et 20 (5 par défaut).
- `MediaUrl` : `{ url, expiresAt }`. `url` est une URL temporaire limitée à ce
  média (6 h par défaut, variable `MEDIA_URL_TTL_SECONDS`), à placer directement
  dans `<audio src>` ou `<video src>`.
- Formats acceptés à l'upload : MP3, WAV, OGG et M4A, 25 Mo maximum.

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
- **Limites.** 10 participants par salon, 20 médias par salon. Par adresse IP :
  10 codes erronés par tranche de 10 minutes, 10 créations de salon par heure.

## Lecture en streaming

1. `GET /media/:id/url` vérifie le jeton de salon et l'appartenance du média au
   salon, puis renvoie une URL signée.
2. Le lecteur charge cette URL sans en-tête `Authorization`. Le serveur répond
   aux requêtes `Range` par `206 Partial Content` (`Accept-Ranges: bytes`,
   `Content-Range`) : la lecture démarre avant la fin du téléchargement et le
   déplacement dans le média fonctionne.
3. Le jeton est porté par la chaîne de requête ; les logs HTTP du backend la
   remplacent par `?[masqué]`.

## Erreurs

Toutes les erreurs ont la forme `{ "message": "…" }`.

| Statut | Cas |
|---|---|
| `400` | `Nom d'affichage requis (30 caractères maximum)`, `Fichier requis`, `Format de média non accepté`, `Fichier trop volumineux (25 Mo maximum)` |
| `401` | `Jeton de salon requis` (en-tête absent), `Salon fermé ou jeton invalide` (jeton falsifié ou expiré, salon fermé ou expiré, participant sorti), `Lien de lecture invalide ou expiré` (route `/stream`) |
| `403` | `Action réservée à l'hôte du salon` (`X-Host-Token` absent ou faux) |
| `404` | `Salon inconnu` (mauvais code à l'entrée), `Média inconnu` (inexistant, appartenant à un autre salon, ou identifiant invalide), `Ressource inconnue` (route `/api` inexistante) |
| `409` | `Salon complet`, `Salon plein : 20 médias maximum` |
| `429` | `Trop de tentatives, réessayez plus tard` (codes erronés), `Trop de salons créés, réessayez plus tard` |
