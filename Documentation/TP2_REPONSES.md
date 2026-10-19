# TP2 — Réponses écrites

## 1. Où se trouve chaque étape ?

| Étape | Fichier / méthode |
|---|---|
| Choix du fichier | `tracks-page.html` (`<input type="file" (change)="choose($event)">`) → `TracksPageComponent.choose()` |
| Validation frontend | `TracksPageComponent.validateFile()` (type MIME, extension, 25 Mo) |
| Construction du `FormData` | `TrackService.upload()` : `append('audio', file)` et `append('title', title)` |
| Appel HTTP d'upload | `TrackService.upload()` → `http.post('/api/tracks', body)` |
| Récupération du `Blob` | `TrackService.audio()` → `http.get('/api/tracks/:id/audio', { responseType: 'blob' })` |
| Création de l'`ObjectURL` | `TracksPageComponent.play()` : `URL.createObjectURL(blob)` |
| Affectation au lecteur | `tracks-page.html` : `<audio [src]="audioUrl()">` |
| Révocation de l'ancienne URL | `play()` (avant de créer la nouvelle), `remove()` (si la piste lue est supprimée) et `ngOnDestroy()` (URL finale) |

### Flux upload
```text
<input file> → choose() → validateFile() → upload()
  → TrackService.upload() → FormData{audio, title} → HttpClient.post
  → authInterceptor (ajoute Authorization: Bearer) → POST /api/tracks
  → auth → Multer (fileFilter + limits) → Track.create → 201
```

### Flux lecture
```text
bouton ▶ → play() → TrackService.audio() → HttpClient.get(responseType: 'blob')
  → authInterceptor → GET /api/tracks/:id/audio → auth + vérification ownerId
  → res.sendFile → Blob → URL.createObjectURL → <audio [src]>
```

## 2. L'intercepteur JWT

`shared/interceptors/auth.interceptor.ts` clone chaque requête passant par `HttpClient`
et ajoute `Authorization: Bearer <token>`. On le voit dans l'onglet Network :
Headers → Request Headers sur `GET /api/tracks/:id/audio`.

Une URL placée directement dans `<audio src="/api/tracks/…/audio">` est chargée par le
navigateur lui-même, pas par `HttpClient`. L'intercepteur n'est donc jamais appelé et
le navigateur n'a aucun moyen d'ajouter un en-tête personnalisé : le middleware `auth`
du backend répondrait `401`. C'est la raison d'être du `Blob` : on récupère le fichier
avec `HttpClient` (donc avec le JWT), puis on donne au lecteur une URL locale
(`blob:`) qui ne nécessite plus d'authentification.

## 3. Contrôles côté backend (`backend/src/app.js`)

- Champ `audio` obligatoire : `if (!req.file)` → `400 "Fichier audio requis"`.
- Champ `title` : `req.body.title || req.file.originalname`.
- Formats : `allowed` (Set de types MIME) utilisé par `fileFilter` de Multer ; sinon
  `Error("Format audio non accepté")` → `400` via le gestionnaire central.
- Taille : `limits: { fileSize: 25 Mo }` → `MulterError` → `400`.
- Propriété : `Track.findOne({ _id, ownerId: req.auth.sub })` → `404` si la piste
  n'appartient pas à l'utilisateur.

Côté frontend, `FormData` contient exactement `audio` et `title`.

### Pourquoi la validation frontend ne remplace pas celle du backend
La validation frontend évite un aller-retour réseau inutile (le fichier de 25 Mo n'est
pas envoyé pour rien) et donne un message immédiat. Mais le code Angular s'exécute chez
l'utilisateur : on peut le modifier, désactiver la vérification ou appeler l'API
directement avec `curl`/Postman. Seul le backend est une frontière de confiance ; il
doit donc refaire toutes les vérifications.

## 4. Pourquoi `Blob` + `ObjectURL` ?

- `Blob` : permet d'obtenir le fichier via `HttpClient`, donc avec le JWT et avec la
  gestion d'erreurs Angular (401, 404…).
- `ObjectURL` : transforme ce `Blob` en URL (`blob:http://…`) utilisable par `<audio>`.
- Il faut la révoquer (`URL.revokeObjectURL`) : tant qu'elle n'est pas révoquée, le
  navigateur garde le `Blob` entier en mémoire, même si plus rien ne l'utilise.
  On révoque l'ancienne URL à chaque nouveau morceau, à la suppression de la piste en
  cours et à la destruction du composant.

Distinction :
- **Téléchargement complet d'un Blob** : tout le fichier est reçu avant que le
  composant reçoive la valeur et que la lecture démarre.
- **Buffering du navigateur** : le lecteur `<audio>` charge à l'avance une partie du
  média dans son tampon pour éviter les coupures. Avec un `blob:`, le fichier est déjà
  entièrement en mémoire.
- **Streaming côté serveur** : le serveur envoie le fichier progressivement (flux
  depuis le disque, éventuellement par morceaux avec les requêtes HTTP `Range`).

## 5. Questions mémoire, buffering et streaming

**Le backend envoie-t-il le fichier entier en mémoire ou progressivement depuis le disque ?**
Progressivement depuis le disque. `res.sendFile(audioPath)` lit le fichier avec un
flux (`fs.createReadStream`) et l'envoie par morceaux ; il n'est pas chargé en entier
dans la mémoire du serveur. `sendFile` gère aussi les requêtes `Range` (réponse `206`).
De même, Multer avec `diskStorage` écrit l'upload directement sur disque.

**Avec `responseType: "blob"`, quand le composant reçoit-il le fichier ?**
Une fois la réponse entièrement reçue : `HttpClient` accumule tous les octets, puis
émet le `Blob` complet. Le lecteur ne démarre donc qu'après le téléchargement complet.

**100 morceaux : 100 fichiers en mémoire dès l'affichage de la liste ?**
Non. `list()` appelle `GET /api/tracks?page&limit` et ne reçoit que des métadonnées
(titre, nom, type, taille, date) ; `storedName` est même exclu par `.select("-storedName")`.
La pagination limite aussi à 5 pistes par requête. Le fichier audio n'est téléchargé que
dans `play()`, pour une seule piste à la fois, et l'ancienne URL est révoquée.

**Différence avec 100 `<audio>` utilisant directement une URL HTTP ?**
Le navigateur gérerait lui-même le chargement : par défaut, selon l'attribut `preload`
(`metadata`/`auto`), chaque élément peut déclencher une requête et mettre en tampon une
partie du fichier, soit potentiellement 100 connexions. Mais la lecture serait un vrai
streaming (le son démarre avant la fin du téléchargement, avec requêtes `Range` pour
se déplacer dans le morceau) et sans copie complète en mémoire JavaScript. En
contrepartie, il faudrait régler le problème d'authentification (pas de header JWT),
par exemple avec un cookie ou un jeton dans l'URL, et utiliser `preload="none"`.

**Pourquoi révoquer l'URL créée par `URL.createObjectURL` ?**
Le navigateur maintient une table entre chaque URL `blob:` et son `Blob` ; tant que
l'URL n'est pas révoquée, le `Blob` (jusqu'à 25 Mo ici) ne peut pas être libéré par le
ramasse-miettes, même si la variable JavaScript n'existe plus. Sans révocation, la
mémoire grossit à chaque morceau lu (fuite mémoire) jusqu'à la fermeture de l'onglet.

## 6. Améliorations facultatives réalisées

- **Barre de progression de l'upload** : `TrackService.upload()` appelle `http.post` avec
  `reportProgress: true` et `observe: 'events'`. Le composant lit les événements
  `HttpEventType.UploadProgress` (`loaded / total`) pour alimenter le signal
  `uploadProgress`, affiché dans un `<progress>` accessible (`aria-label`,
  `aria-valuetext`). L'événement `HttpEventType.Response` contient la piste créée et
  déclenche le message de succès, le vidage du formulaire et le rechargement de la page 1.
  Sur `localhost`, l'envoi est quasi instantané ; pour voir la barre, limiter le débit
  dans l'onglet Network (throttling).
- **Suppression avec confirmation** : `remove()` demande une confirmation (`confirm`),
  appelle `DELETE /api/tracks/:id`, révoque l'`ObjectURL` si la piste supprimée était en
  cours de lecture, puis recharge la page courante.
- **Rafraîchissement après suppression** : `load()` est rappelé après le `204`.
- **Formatage lisible** : `formatSize()` (o, Ko, Mo, Go), `formatDate()` (locale `fr-FR`)
  et `formatMimeType()`.
- **Filtre par titre** : champ de recherche lié au signal `filterText`, avec un `computed`
  `visibleTracks` qui filtre `tracks()` sur le titre sans tenir compte de la casse.
  Limite : le backend n'a pas de paramètre de recherche, donc le filtre ne porte que sur
  la page chargée (5 pistes) et non sur toute la bibliothèque. Un filtre global
  demanderait un paramètre côté API (par exemple `q`) et la mise à jour de
  `API_CONTRACT.md`. Ce n'est pas un contournement de la pagination serveur : la liste
  n'est toujours pas récupérée en entier.

## 7. Checkpoint Network (à compléter avec vos captures)

- [ ] Changement de page → paramètre `page` modifié (`GET /api/tracks?page=2&limit=5`)
- [ ] Upload → `Content-Type: multipart/form-data`, champs `audio` et `title`
- [ ] Lecture → `GET /api/tracks/:id/audio`, `Content-Type: audio/mpeg`, header `Authorization`
- [ ] Fichier invalide (ex. `.txt` renommé en `.mp3`, ou un fichier de plus de 25 Mo
      envoyé avec `curl`) → `400` affiché dans l'interface
- [ ] Un second utilisateur ne peut pas lire la piste du premier → `404 "Piste inconnue"`
