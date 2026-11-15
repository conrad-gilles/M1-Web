# Contrat HTTP

Base : `/api`. Sauf inscription, connexion et flux d'un média, envoyer
`Authorization: Bearer <token>`.

Le contrat HTTP ne dépend pas du choix de persistance : MongoDB conserve les
utilisateurs et les métadonnées ; les octets des fichiers sont confiés au
module de stockage du backend (`backend/src/storage/`, disque local pour
l'instant).

| Méthode | Route | Authentification | Requête | Réponse principale |
|---|---|---|---|---|
| GET | `/health` | - | - | `200 { "status": "ok" }` |
| POST | `/auth/register` | - | `{name,email,password}` | `201 {token,user}` |
| POST | `/auth/login` | - | `{email,password}` | `200 {token,user}` |
| GET | `/users/me` | JWT | - | `200 User` |
| PUT | `/users/me` | JWT | `{name}` | `200 User` |
| GET | `/media?page=1&limit=5` | JWT | - | `200 Page<Media>` |
| POST | `/media` | JWT | multipart : `file`, `title` | `201 Media` |
| GET | `/media/:id/url` | JWT | - | `200 MediaUrl` |
| GET | `/media/:id/stream?token=…` | jeton de l'URL | en-tête `Range` facultatif | `200` ou `206`, octets du média |
| DELETE | `/media/:id` | JWT | - | `204` |

## Formats

- `Media` : `{ id, kind, title, originalName, mimeType, size, createdAt }`, avec
  `kind` égal à `"audio"` ou `"video"`.
- `Page<Media>` : `{ items, page, limit, total, pages }`. `page` vaut au moins 1,
  `limit` est compris entre 1 et 20 (5 par défaut).
- `MediaUrl` : `{ url, expiresAt }`. `url` est une URL temporaire limitée à ce
  média (6 h par défaut, variable `MEDIA_URL_TTL_SECONDS`), à placer directement
  dans `<audio src>` ou `<video src>`.
- Formats acceptés à l'upload : MP3, WAV, OGG et M4A, 25 Mo maximum.

## Lecture en streaming

1. `GET /media/:id/url` vérifie le JWT et l'appartenance du média, puis renvoie
   une URL signée.
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
| `400` | Validation : champs manquants, `Fichier requis`, `Format de média non accepté`, `Fichier trop volumineux (25 Mo maximum)` |
| `401` | `Authentification requise`, `Jeton invalide ou expiré`, `Identifiants incorrects`, `Lien de lecture invalide ou expiré` (route `/stream`) |
| `404` | `Média inconnu` (inexistant, appartenant à un autre utilisateur, ou identifiant invalide), `Utilisateur inconnu`, `Ressource inconnue` (route `/api` inexistante) |
| `409` | `Email déjà utilisé` |
