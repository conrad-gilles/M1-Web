# TP2 — Bibliothèque Upload et Lecture Audio

## Objectif

Construire une bibliothèque audio agréable et robuste, en utilisant la pagination serveur et une lecture audio authentifiée.

Durée maximale : 2 heures. Le backend fournit déjà les endpoints nécessaires : ne le modifiez pas pour les missions principales.

## Prérequis

Le TP1 doit être fonctionnel. Le backend doit être lancé, le frontend doit utiliser la bonne cible dans `proxy.conf.json`, et le compte de test doit pouvoir se connecter. Préparer quelques fichiers audio libres de droits de moins de 25 Mo. Vous en avez deux dans fichiers-audio-de-test

Le contrat est : `GET /api/tracks?page=1&limit=5`, `POST /api/tracks` avec les champs multipart `audio` et `title`, et `GET /api/tracks/:id/audio` avec JWT.

## Déroulement conseillé

| Temps | Activité | Production attendue |
|---|---|---|
| 0:00–0:10 | Vérification du flux d’authentification | utilisateur connecté |
| 0:10–0:55 | Bibliothèque paginée | pages serveur fonctionnelles |
| 0:55–1:45 | Upload et lecture audio | piste envoyée et lue |
| 1:45–2:00 | Cards, erreurs et vérification Network | interface présentable et preuves |

## Mission 2 — Bibliothèque paginée

Le backend fournit déjà `GET /api/tracks?page=1&limit=5`. Ne modifiez pas le backend pour cette mission.

Implémenter ou vérifier `TrackService.list(page, limit)` afin qu’il transmette réellement `page` et `limit`. Le flux attendu est :

```text
composant bibliothèque → TrackService → HttpClient → GET /api/tracks?page=...&limit=...
```

Représenter avec des Signals :

- la liste `tracks` ;
- la page courante `page` ;
- le nombre total de pages `pages` ;
- l’état de chargement `loading` ;
- l’erreur éventuelle.

Afficher les résultats avec `@for`, l’état vide avec `@empty` et le chargement avec `@if`. Ajouter les boutons « Précédent » et « Suivant », désactivés aux bornes.

Après chaque changement de page, effectuer une nouvelle requête HTTP. Il est interdit de récupérer toutes les pistes puis de les découper localement dans Angular.

### AVANCÉ — Angular Material

Utiliser le composant Paginator de la bibliothèque graphique Angular Material. Allez le voir en action sur https://material.angular.dev/components/paginator/overview.

### AVANCÉ — Pagination Mongoose

Cette option est facultative. Il existe un plugin Mongoose très puissant, `aggregate-paginate-v2`, décrit dans les slides Angular dans la partie back-end. Cette tâche consiste à faire en sorte que le backend implémente la pagination à l'aide de ce plugin. Attention, le plugin renvoie au client des données beaucoup plus complètes : il faudra donc également mettre à jour `API_CONTRACT.md` et le frontend.

## Mission 3 — Analyse amélioration de l’upload et de la lecture audio

Le backend et le `frontend-starter` fournissent déjà le mécanisme principal d’upload et de lecture sécurisée. Ne réimplémentez pas ce qui existe déjà et ne modifiez pas le contrat HTTP.

Commencez par identifier dans quels fichiers et quelles méthodes se trouvent : le choix du fichier, la construction du `FormData`, l’appel HTTP d’upload, la récupération du `Blob`, la création de l’`ObjectURL`, l’affectation au lecteur `<audio>` et la révocation de l’ancienne URL. Expliquez le flux composant → service → `HttpClient` → API, puis API → `Blob` → `ObjectURL` → lecteur audio.

Dans l'onglet Network du debugger de votre navigateur, et dans le code, repérez aussi l’intercepteur qui ajoute le JWT à la requête audio. Expliquez pourquoi une URL directement placée dans `src` ne reçoit pas automatiquement ce header.

Le backend vérifie déjà que le multipart contient le fichier `audio`, lit le champ `title`, accepte les formats audio prévus et refuse les fichiers de plus de 25 Mo. Identifiez ces contrôles dans le code backend et vérifiez que le frontend construit bien le `FormData` avec exactement `audio` et `title`.

Complétez uniquement ce qui manque côté frontend : effectuer également ces vérifications avant l’appel HTTP, puis afficher un message d’erreur clair si le fichier est invalide. Expliquez pourquoi la validation frontend améliore l’expérience mais ne remplace jamais la validation backend.

Ajoutez ou complétez uniquement les éléments d’interface manquants pendant l’envoi :

- afficher un état de chargement ;
- désactiver le bouton et empêcher les doubles soumissions ;
- afficher les erreurs du serveur ;
- afficher un message de succès ;
- vider le formulaire et recharger la première page après succès.

Présenter les morceaux sous forme de cards responsives et accessibles. Une card peut afficher le titre, le nom original, le format, la taille, la date d’ajout et une action de lecture.

Vérifiez le mécanisme de lecture déjà présent et complétez ce qui manque : afficher le morceau en cours, afficher une erreur audio compréhensible et révoquer l’`ObjectURL` finale à la destruction du composant.  Distinguez le téléchargement complet d’un `Blob`, le buffering du navigateur et le streaming côté serveur.

### Questions sur mémoire buffering et streaming

- Le backend envoie-t-il le fichier entier en mémoire ou peut-il l’envoyer progressivement depuis le disque ?
- Avec `HttpClient` et `responseType: "blob"`, à quel moment le composant reçoit-il généralement le fichier ?
- Si la bibliothèque contient 100 morceaux, les 100 fichiers audio sont-ils chargés en mémoire dès l'affichage de la liste ? Justifier la réponse à partir du code.
- Quelle différence y aurait-il avec 100 éléments `<audio>` utilisant directement une URL HTTP ?
- Pourquoi l'URL créée par `URL.createObjectURL` doit-elle être révoquée ?

## Améliorations facultatives

- barre de progression de l’upload ;
- suppression avec confirmation via `DELETE /api/tracks/:id` ;
- rafraîchissement après suppression ;
- formatage lisible de la taille et de la date ;
- filtre par titre.

## AVANCÉ — Image de couverture

Ajouter une image de couverture pour chaque morceau. Deux approches sont possibles :

- permettre à l’utilisateur d’uploader une image associée au morceau ;
- rechercher une image sur le Web, et aussi les autres métadonnées disponibles à partir des tags ID3 ou du nom du fichier (titre, auteur, etc.). Cherchez ce que proposent les tags id3 et quels web services publics peuvent être utilisées pour effectuer cette tâche.

Cette option nécessite d’identifier les modifications de données et d’API avant toute implémentation. Respecter les règles de sécurité, d’accessibilité et de droits d’utilisation des images.

## Checkpoint Network

Vérifier :

- que chaque changement de page modifie le paramètre `page` ;
- que l’upload est bien multipart et contient `audio` et `title` ;
- que la réponse de lecture est un flux audio ;
- qu’une erreur `400` est affichée pour un fichier invalide ;
- qu’une piste ne peut être lue que par son propriétaire.

## Livrables TP2

- code frontend complété ;
- cards de bibliothèque lisibles ;
- capture Network de la pagination ou de l’upload ;
- capture ou démonstration de la lecture audio authentifiée ;
- explication écrite du choix `Blob` et `ObjectURL`.
- réponses aux questions sur mémoire, buffering et streaming audio.
