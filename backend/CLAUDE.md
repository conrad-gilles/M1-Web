# Instructions pour Claude Code

Suis `AGENTS.md` et lis `best-practices.md` avant de modifier l’API. Consulte
`../API_CONTRACT.md` pour connaître les routes et les formats attendus.

Travaille par petites étapes. Commence par identifier les fichiers concernés et
le flux `route Express -> middleware -> handler -> Mongoose -> MongoDB`. Pour un
upload, décris aussi le flux `multipart/form-data -> Multer -> validation ->
stockage -> métadonnées`.

Ne modifie pas le contrat HTTP sans mettre à jour `../API_CONTRACT.md` dans la
même mission. Toute nouvelle route ou route modifiée doit documenter sa
méthode, son URL, son authentification, ses paramètres, son corps, ses réponses
et ses erreurs. Ne mets jamais de secret dans le code et présente un diff
limité. Toute erreur doit être visible dans les logs et dans la réponse HTTP
appropriée.
