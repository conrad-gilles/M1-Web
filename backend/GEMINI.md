# Instructions pour Gemini CLI

Lis `AGENTS.md`, `best-practices.md` et les sections pertinentes de
`../Documentation/API_CONTRACT.md` et `../Documentation/SYNC_PROTOCOL.md` avant
toute modification.

Respecte l’architecture existante (Express/Mongoose, salons et jetons de salon,
module de stockage, Socket.IO), les validations et les codes HTTP. Si tu ajoutes
ou modifies une route, mets aussi à jour `../Documentation/API_CONTRACT.md` dans la
même mission en documentant méthode, URL, authentification, paramètres, corps,
réponses et erreurs ; pour un événement temps réel, mets à jour
`../Documentation/SYNC_PROTOCOL.md`. Utilise `async`/`await`, des erreurs
explicites et des logs sans secret. Pour les fichiers reçus avec Multer, vérifie
la taille, le type et le nom de stockage avant toute écriture.

Analyse d’abord le code et propose les fichiers à changer. Après modification,
lance les tests disponibles et résume les requêtes, erreurs et vérifications.
