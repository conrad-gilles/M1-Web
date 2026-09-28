# Instructions pour les assistants de programmation

Ce dossier contient une API Node.js/Express avec Mongoose et MongoDB. Lis
`best-practices.md`, `../API_CONTRACT.md` et `../ATLAS_SETUP.md` avant toute
modification.

- Préserver les routes, les méthodes HTTP et les formats définis dans `API_CONTRACT.md`.
- Si une route est ajoutée ou modifiée, mettre à jour `../API_CONTRACT.md` dans la même mission : méthode, URL, authentification, paramètres, corps, réponses et erreurs.
- Ne jamais modifier ou exposer les secrets contenus dans `.env`.
- Utiliser `async`/`await` avec une gestion explicite des erreurs.
- Ne jamais laisser un `catch` vide : journaliser l’erreur et transmettre une réponse HTTP appropriée.
- Utiliser les middlewares Express pour séparer validation, authentification et traitement métier.
- Utiliser Mongoose pour les schémas, la validation et les requêtes MongoDB.
- Ne jamais construire une requête MongoDB à partir d’une entrée utilisateur non validée.
- Pour Multer, limiter la taille, contrôler le type de fichier et sécuriser le nom de stockage.
- Ne jamais journaliser de mot de passe, secret JWT, token ou URI MongoDB.
- Conserver les logs utiles pour suivre les opérations et les erreurs.
- Après une modification : lancer les tests disponibles, vérifier les réponses HTTP et expliquer les résultats.
