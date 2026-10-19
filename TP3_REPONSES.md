# TP3 — Réponses écrites et rapport de tests

## 1. Mission 5 — Suppression d'une piste

### Composant et service concernés
- Composant : `TracksPageComponent` (`components/tracks-page/tracks-page.ts`), méthode `remove(track)`.
- Service : `TrackService.remove(id)` → `http.delete('/api/tracks/:id')`.
- Le composant n'injecte jamais `HttpClient` : il ne connaît que `TrackService`.

### Flux
```text
bouton « Supprimer » (card) → remove(track) → confirm()
  → TrackService.remove → HttpClient.delete → authInterceptor (Bearer JWT)
  → DELETE /api/tracks/:id → 204
  → SnackBar « supprimée » + load() (nouvelle requête GET de la page courante)
```

### Ce qui est géré
| Exigence | Réalisation |
|---|---|
| Action « Supprimer » dans chaque card | bouton avec le texte visible « Supprimer » et un `aria-label` contenant le titre |
| Confirmation | `confirm()` ; si l'utilisateur annule, aucune requête n'est envoyée |
| Pas de double clic | signal `deletingId` : `remove()` retourne immédiatement s'il est renseigné, et tous les boutons « Supprimer » sont désactivés pendant la suppression |
| Message de succès / d'erreur | `MatSnackBar` (Angular Material), 5 s, annoncé aux lecteurs d'écran |
| Mise à jour de la page | `load()` après le `204` ; si la page courante devient vide (dernière piste de la page 2 supprimée), `load()` recule automatiquement sur la dernière page existante |
| Piste déjà supprimée / pas à soi | le backend répond `404 "Piste inconnue"` dans les deux cas ; le frontend affiche « Cette piste n'existe plus ou ne vous appartient pas. La liste a été mise à jour. » et recharge la liste, ce qui fait disparaître la card obsolète. Si la piste obsolète était en cours de lecture, la lecture est arrêtée et l'`ObjectURL` révoquée |
| Autres erreurs (500, réseau) | message du serveur (ou message par défaut) dans le SnackBar, liste inchangée |

### Pourquoi le guard Angular et l'interface ne suffisent pas à sécuriser la suppression
- Le guard (`authGuard`) et le bouton masqué ou désactivé n'agissent que dans le navigateur de
  l'utilisateur. Tout le code Angular est téléchargé chez lui : il peut le modifier, appeler
  `DELETE /api/tracks/<id>` avec `curl` ou Postman, ou réutiliser un vieux token.
- Le guard vérifie seulement qu'un token **existe** dans le `localStorage` ; il ne vérifie ni sa
  signature, ni son expiration, ni à qui appartient la piste.
- C'est le backend qui protège réellement, dans `DELETE /api/tracks/:id` :
  1. le middleware `auth` vérifie la signature et l'expiration du JWT (`jwt.verify`) → `401` sinon ;
  2. la requête `Track.findOneAndDelete({ _id, ownerId: req.auth.sub })` n'efface que si la piste
     appartient à l'utilisateur dont l'identité vient **du JWT** (jamais d'une valeur envoyée par le client) ;
     sinon `404`, sans révéler si la piste existe chez quelqu'un d'autre.
- Ces deux points sont couverts par des tests backend (section 4).

## 2. Mission 6 — Progression de l'upload

### États
Le composant utilise un seul signal `uploadState` de type `UploadState`
(`shared/models/upload-state.model.ts`), union discriminée :

| État | Signification | Affichage |
|---|---|---|
| `idle` | aucun envoi | formulaire actif |
| `uploading` + `percent` | envoi en cours (`percent: null` si la taille totale est inconnue) | barre `<progress>` + « 42 % » ; indéterminée si `null` |
| `success` + `title` | réponse `201` reçue | message de succès, formulaire vidé, page 1 rechargée |
| `error` + `message` | échec réseau ou réponse d'erreur | message d'erreur, formulaire réactivé, nouvel essai possible |

Un seul état est actif à la fois : il est impossible d'afficher « succès » et « erreur » ensemble.

### Pendant l'envoi
- Le champ titre est désactivé (`title.disable()`), l'`<input type="file">` et le bouton aussi
  (`[disabled]="uploading()"`).
- `upload()` retourne immédiatement si `uploading()` est vrai : une seconde soumission est ignorée.
- Rien de sensible n'est journalisé : les `console.error` n'affichent que `error.status`, jamais
  l'objet de requête complet, le mot de passe ni le JWT.

### Comment Angular calcule le pourcentage
`HttpClient.post(url, body, { reportProgress: true, observe: 'events' })` émet des
`HttpEvent`. Pendant l'envoi du corps, le navigateur signale `loaded` (octets déjà envoyés) et
`total` (taille totale du corps). Angular les expose dans un `HttpProgressEvent`
(`type: HttpEventType.UploadProgress`) et le composant calcule
`Math.round(100 * loaded / total)`. `total` peut être `undefined` si la taille est inconnue,
d'où l'état indéterminé.

### Pourquoi ce n'est pas traité comme une requête qui n'émet qu'une réponse finale
- Une requête classique (`observe: 'body'`) émet **une seule** valeur : le corps de la réponse.
- Avec `observe: 'events'`, l'Observable émet **plusieurs** valeurs de types différents :
  `Sent` (type 0), plusieurs `UploadProgress` (type 1), puis `ResponseHeader` (2) éventuellement
  et enfin `Response` (4) qui contient la piste créée dans `body`.
- Le `next` doit donc **filtrer par `event.type`** : traiter chaque événement comme la piste créée
  serait faux (ce serait un `HttpProgressEvent`, sans `id` ni `title`). Le succès ne doit être
  déclaré qu'à l'événement `Response`, et l'erreur reste signalée par le canal `error`.
- Le corps de la réponse n'est connu qu'à la fin ; le pourcentage, lui, évolue en continu.

## 3. Mission 7 — Tests automatisés

### Outils
- Frontend : `ng test --watch=false` (builder `@angular/build:unit-test`, exécuteur **Vitest**,
  environnement **jsdom**). `HttpTestingController` remplace le réseau.
- Backend : `node --test` (test runner natif de Node), `mock` de `node:test` pour simuler Mongoose.
- Nouveaux fichiers de configuration : `tsconfig.spec.json`, options `buildTarget`/`tsConfig`
  du target `test` dans `angular.json`, et `"exclude": ["src/**/*.spec.ts"]` dans
  `tsconfig.app.json` pour que `npm run build` ne compile pas les tests.
- Dépendances ajoutées : `@angular/material` et `@angular/cdk` (SnackBar), `jsdom` (dev, requis par Vitest).

### Rapport de tests frontend (34 tests, tous passés)

| Fichier | Test | Résultat attendu | Résultat observé |
|---|---|---|---|
| `track.service.spec.ts` | `list()` transmet page et limit | `GET /api/tracks?page=3&limit=10` | ✅ |
| | `list()` valeurs par défaut | `page=1`, `limit=5` | ✅ |
| | `upload()` multipart | `POST /api/tracks`, `reportProgress`, champs exactement `audio` et `title` | ✅ |
| | `upload()` événements | `Sent`, `UploadProgress`, `Response` dans cet ordre | ✅ (premier essai : échec, j'avais oublié `Sent` ; test corrigé) |
| | `remove()` | `DELETE /api/tracks/abc123` | ✅ |
| | `audio()` | `GET …/audio` avec `responseType: 'blob'` | ✅ |
| `auth.service.spec.ts` | `login()` corps | `POST /api/auth/login` avec `{ email, password }` | ✅ |
| | `login()` succès | token et utilisateur stockés (signal + `localStorage`) | ✅ |
| | `login()` 401 | rien stocké, erreur propagée | ✅ |
| | `logout()` | token et utilisateur effacés | ✅ |
| `auth.interceptor.spec.ts` | token présent | header `Authorization: Bearer jwt-de-test` | ✅ |
| | pas de token | aucun header `Authorization` | ✅ |
| | token changé | le header suit le token courant | ✅ |
| `auth.guard.spec.ts` | sans token | `UrlTree` vers `/login` | ✅ |
| | avec token | `true` | ✅ |
| `tracks-page.spec.ts` | chargement | GET page=1 limit=5, une card par piste | ✅ |
| | échec HTTP | message d'erreur affiché (`role="alert"`) | ✅ |
| | `go()` | nouvelle requête avec la bonne page ; aucune requête hors bornes | ✅ (2 tests) |
| | bouton « Supprimer » | présent dans chaque card | ✅ |
| | confirmation refusée | aucune requête | ✅ |
| | suppression | `DELETE`, SnackBar de succès, rechargement | ✅ |
| | double clic | une seule requête `DELETE` | ✅ |
| | `404` | message « n'existe plus… », liste rechargée | ✅ |
| | `500` | message du serveur, pas de rechargement | ✅ |
| | dernière piste de la page | recule sur la page précédente | ✅ |
| | upload : états | `idle` → `uploading` (25 %) → champs désactivés → seconde soumission ignorée | ✅ |
| | upload : taille inconnue | `percent: null` (barre indéterminée) | ✅ |
| | upload : succès | état `success`, formulaire vidé, page 1 rechargée | ✅ |
| | upload : échec 400 | état `error` avec le message du serveur, formulaire réactivé | ✅ |
| | upload : sans titre | titre = nom du fichier | ✅ |
| | upload : sans fichier | aucun envoi | ✅ |
| | fichier invalide | rejeté avant tout appel HTTP | ✅ |

**Vérification que les tests testent vraiment quelque chose** : j'ai temporairement supprimé la
garde anti-double-clic et la gestion du `404` dans `remove()` ; les deux tests correspondants
ont échoué (32 réussis, 2 échoués). Le code a ensuite été restauré.

### Extension backend (10 tests : 2 existants + 8 nouveaux, tous passés)

| Test | Résultat attendu | Observé |
|---|---|---|
| 401 sans JWT (5 routes protégées) | `401 "Authentification requise"` | ✅ |
| 401 JWT invalide / mauvaise signature / expiré / mauvais schéma | `401` | ✅ |
| upload sans fichier | `400 "Fichier audio requis"` | ✅ |
| type MIME refusé (`text/plain`) | `400 "Format audio non accepté"` | ✅ |
| pagination `page=2&limit=3` | `skip(3)`, `limit(3)`, `pages=3`, filtre `{ ownerId }` | ✅ |
| pagination `page=-4&limit=500` | page 1, limit plafonné à 20 | ✅ |
| piste d'un autre utilisateur (audio + DELETE) | `404`, filtre avec `ownerId` du JWT | ✅ |
| DELETE d'une piste inexistante | `404 "Piste inconnue"` | ✅ |

Aucune route du backend n'a été modifiée.

### Commandes lancées
```bash
cd frontend-starter && npm test        # 34 passed
cd backend          && npm test        # 10 passed
cd frontend-starter && npm run build   # build réussi
```

## 4. Restitution orale

1. **Pourquoi la suppression passe par un service ?** Le composant ne doit s'occuper que de
   l'interface et de l'état. `TrackService` regroupe tous les appels HTTP sur les pistes : URL,
   méthode et paramètres au même endroit, réutilisable, et facile à simuler dans les tests
   (on remplace le réseau sans toucher au composant).
2. **Comment le backend protège la suppression ?** Middleware `auth` (JWT valide et non expiré,
   sinon 401) puis `findOneAndDelete({ _id, ownerId: req.auth.sub })` : seule une piste de
   l'utilisateur identifié par le token est supprimée, sinon 404. Le fichier est ensuite supprimé
   du disque (`unlink`).
3. **Comment Angular calcule le pourcentage ?** Via `reportProgress: true` et `observe: 'events'` :
   les événements `UploadProgress` contiennent `loaded` et `total`, et le composant calcule
   `Math.round(100 * loaded / total)`.
4. **Pourquoi les tests HTTP n'ont pas besoin de MongoDB ?** Côté frontend,
   `HttpTestingController` intercepte les requêtes avant le réseau : on vérifie l'URL, la méthode,
   les paramètres et les headers, puis on fournit nous-mêmes la réponse (`flush`). Côté backend,
   on appelle l'application Express réelle mais les méthodes Mongoose sont remplacées par des
   simulations (`mock.method`) ; on teste le contrat HTTP et le filtrage par propriétaire, pas MongoDB.
5. **Que vérifie un test d'intercepteur ou de guard ?** Intercepteur : que la requête sortante
   porte `Authorization: Bearer <token>` quand un token existe, et pas de header sinon. Guard :
   qu'il retourne `true` avec un token et un `UrlTree` vers `/login` sans token (la redirection est
   décidée par le guard, pas par la page).
6. **Différence entre test unitaire et test d'intégration ?** Un test unitaire vérifie une unité
   isolée (un service avec un faux `HttpClient`, un guard seul) ; ses dépendances sont simulées,
   il est rapide et localise précisément l'erreur. Un test d'intégration vérifie plusieurs
   éléments réels ensemble : par exemple `HttpClient` + intercepteur + service, ou le composant
   avec son template et le service, ou une vraie route Express avec son middleware `auth` et Multer.
   Ici, `tracks-page.spec.ts` et les tests backend sont plutôt de l'intégration partielle (la base
   de données reste simulée) ; les specs de service, guard et intercepteur sont des tests unitaires.

## 5. Preuves à fournir par le binôme

- [ ] Capture Network d'une requête `DELETE /api/tracks/:id` après confirmation (statut `204`).
- [ ] Capture Network de l'upload (`POST /api/tracks`, multipart) et de ses événements de
      progression. Sur `localhost` l'envoi est quasi instantané : activer le throttling
      (Slow 3G) et choisir un fichier un peu gros pour voir la barre avancer.
- [ ] Console du navigateur : aucune erreur inattendue, aucun token ni mot de passe affiché.
- [ ] Capture du SnackBar de suppression et de celui du cas `404` (supprimer la même piste dans
      deux onglets).
