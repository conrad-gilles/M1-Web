# Instructions pour Claude Code

Suis `AGENTS.md` et lis `best-practices.md` avant de modifier l’API. Consulte
`../Documentation/API_CONTRACT.md` pour les routes et les formats attendus, et
`../Documentation/SYNC_PROTOCOL.md` pour le canal temps réel.

Travaille par petites étapes. Commence par identifier les fichiers concernés et
le flux `route Express -> middleware (roomAuth) -> handler -> Mongoose -> MongoDB`.
Pour un upload, décris aussi le flux `multipart/form-data -> Multer -> validation ->
module de stockage -> métadonnées`. Pour la synchronisation, décris le flux
`événement Socket.IO -> realtime.js -> RoomSync (src/sync/) -> diffusion au salon`.

Ne modifie pas le contrat HTTP ni le protocole temps réel sans mettre à jour
`../Documentation/API_CONTRACT.md` ou `../Documentation/SYNC_PROTOCOL.md` dans la
même mission. Toute nouvelle route ou route modifiée doit documenter sa méthode,
son URL, son authentification, ses paramètres, son corps, ses réponses et ses
erreurs. Ne mets jamais de secret dans le code et présente un diff limité. Toute
erreur doit être visible dans les logs et dans la réponse HTTP appropriée.
