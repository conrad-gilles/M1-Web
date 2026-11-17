# Instructions pour les assistants de programmation

Ce dossier contient l'API de Sharing Platform : Node.js/Express avec Mongoose
et MongoDB, plus un canal temps réel Socket.IO. Lis `best-practices.md`,
`../Documentation/API_CONTRACT.md`, `../Documentation/SYNC_PROTOCOL.md` et
`../Documentation/ATLAS_SETUP.md` avant toute modification.

- Il n'y a pas de comptes : l'accès repose sur le jeton de salon (`middleware/roomAuth.js`). Toute requête sur des médias doit être filtrée sur le salon du jeton, jamais sur une valeur envoyée par le client.
- Préserver les routes, les méthodes HTTP et les formats définis dans `API_CONTRACT.md`.
- Si une route est ajoutée ou modifiée, mettre à jour `../Documentation/API_CONTRACT.md` dans la même mission : méthode, URL, authentification, paramètres, corps, réponses et erreurs.
- Si un événement Socket.IO ou une règle de synchronisation change, mettre à jour `../Documentation/SYNC_PROTOCOL.md` dans la même mission.
- Garder la logique de synchronisation dans des fonctions pures testables (`src/sync/`), avec l'heure passée en paramètre.
- Passer par le module de stockage (`src/storage/`) pour lire, signer ou supprimer un fichier, jamais par un chemin construit à la main.
- Ne jamais modifier ou exposer les secrets contenus dans `.env`.
- Utiliser `async`/`await` avec une gestion explicite des erreurs.
- Ne jamais laisser un `catch` vide : journaliser l’erreur et transmettre une réponse HTTP appropriée.
- Utiliser les middlewares Express pour séparer validation, authentification et traitement métier.
- Utiliser Mongoose pour les schémas, la validation et les requêtes MongoDB.
- Ne jamais construire une requête MongoDB à partir d’une entrée utilisateur non validée.
- Pour Multer, limiter la taille, contrôler le type de fichier et sécuriser le nom de stockage.
- Ne jamais journaliser de secret JWT, jeton (de salon, d'hôte ou d'URL de lecture) ou URI MongoDB.
- Conserver les logs utiles pour suivre les opérations et les erreurs.
- Après une modification : lancer les tests disponibles, vérifier les réponses HTTP et expliquer les résultats.
