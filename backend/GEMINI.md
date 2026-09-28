# Instructions pour Gemini CLI

Lis `AGENTS.md`, `best-practices.md` et les sections pertinentes de
`../API_CONTRACT.md` avant toute modification.

Respecte l’architecture Express/Mongoose existante, les validations et les
codes HTTP. Si tu ajoutes ou modifies une route, mets aussi à jour
`../API_CONTRACT.md` dans la même mission en documentant méthode, URL,
authentification, paramètres, corps, réponses et erreurs. Utilise `async`/`await`,
des erreurs explicites et des logs sans secret. Pour les fichiers reçus avec
Multer, vérifie la taille, le type et le nom de stockage avant toute écriture.

Analyse d’abord le code et propose les fichiers à changer. Après modification,
lance les tests disponibles et résume les requêtes, erreurs et vérifications.
