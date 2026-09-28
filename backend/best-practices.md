# Bonnes pratiques backend

Ce document sert de référence pour les travaux dans `backend/`. Les assistants
peuvent proposer du code, mais l’étudiant doit comprendre, tester et expliquer
chaque modification.

## Node.js et configuration

- Utiliser une version Node.js compatible avec `package.json`.
- Garder la configuration dans des variables d’environnement et fournir des valeurs d’exemple dans `.env.example`.
- Ne jamais committer `.env`, une URI MongoDB complète, un mot de passe ou un secret JWT.
- Préférer `async`/`await` et des fonctions courtes dont la responsabilité est identifiable.
- Attendre la connexion à MongoDB avant d’accepter les requêtes qui nécessitent la base.

## Express : routes et middlewares

Une requête suit généralement ce chemin :

```text
route -> middleware -> handler/controller -> modèle Mongoose -> MongoDB
```

- Les routes décrivent les URL et les méthodes HTTP. Toute route ajoutée ou modifiée doit entraîner la mise à jour de `../API_CONTRACT.md` dans la même mission, avec la méthode, l’URL, l’authentification, les paramètres, le corps, les réponses et les erreurs.
- Les middlewares traitent l’authentification, la validation, les logs ou les fichiers reçus.
- Un handler orchestre l’opération et renvoie une réponse une seule fois.
- Utiliser des codes HTTP cohérents : `2xx` succès, `4xx` requête invalide ou non autorisée, `5xx` erreur serveur.
- Vérifier `req.params`, `req.query`, `req.body` et `req.file`.
- Ne pas faire confiance aux données envoyées par le navigateur.

Pour une erreur asynchrone, ne pas l’ignorer :

```js
try {
  const result = await operation();
  console.log('[operation] succès', { id: result.id });
  return res.status(200).json(result);
} catch (error) {
  console.error('[operation] échec', error);
  return res.status(500).json({ message: 'Erreur interne du serveur' });
}
```

Dans une application plus grande, un middleware d’erreur centralisé peut
recevoir les erreurs via `next(error)`. Il doit journaliser l’erreur côté
serveur, sans révéler la stack ni les secrets au client en production.

Documentation : [middleware Express](https://expressjs.com/en/guide/using-middleware.html).

## Mongoose et MongoDB

- Définir un schéma Mongoose explicite avec types, champs obligatoires, contraintes et valeurs par défaut utiles.
- Valider les données avant l’écriture et traiter les erreurs de validation.
- Vérifier les identifiants avec `mongoose.isValidObjectId` avant une recherche.
- Ne pas concaténer des fragments de requête à partir d’entrées utilisateur.
- Utiliser `.lean()` pour les lectures qui n’ont pas besoin de méthodes Mongoose.
- Sélectionner uniquement les champs nécessaires, notamment lorsqu’un document contient des informations sensibles.
- Ajouter des index seulement lorsqu’ils correspondent à des recherches réelles et comprendre leur coût en écriture.
- Pour une liste paginée, valider `page` et `limit`, imposer un maximum et retourner des métadonnées cohérentes.
- Ne jamais stocker un mot de passe en clair et ne jamais le renvoyer dans une réponse JSON.

Documentation : [Mongoose Schemas](https://mongoosejs.com/docs/guide.html) et
[sécurité MongoDB](https://www.mongodb.com/docs/manual/core/security/).

## Multer et les uploads

Multer est un middleware Express qui analyse les requêtes
`multipart/form-data` et rend les fichiers accessibles via `req.file` ou
`req.files`. Il est utile pour recevoir un fichier, mais il ne constitue pas à
lui seul une validation de sécurité.

Documentation : [dépôt officiel Multer](https://github.com/expressjs/multer).

Bonnes pratiques :

- utiliser Multer uniquement sur les routes qui acceptent un upload ;
- définir une limite de taille (`limits.fileSize`) ;
- filtrer les extensions et types autorisés, puis vérifier le contenu si nécessaire ;
- générer un nom interne unique plutôt que d’utiliser directement `originalname` ;
- empêcher les chemins relatifs, les caractères dangereux et les collisions ;
- ne jamais exécuter ni interpréter un fichier envoyé par un utilisateur ;
- prévoir le cas où aucun fichier n’est reçu et traiter explicitement les erreurs Multer ;
- stocker les fichiers dans un répertoire contrôlé ;
- supprimer le fichier si l’écriture MongoDB échoue après l’upload, ou prévoir un nettoyage ;
- pour des fichiers volumineux, réfléchir au streaming et aux téléchargements partiels.

## Lecture audio et authentification

- Utiliser un chemin de fichier contrôlé par le serveur, jamais un chemin fourni directement par le client.
- Authentifier les pistes protégées avant d’envoyer le fichier.
- Préserver les en-têtes et le comportement nécessaires à la lecture audio, notamment `Range` si pris en charge.
- Vérifier l’identité issue du JWT plutôt que celle fournie par `req.body`.
- Distinguer absence de token, token invalide et utilisateur non autorisé.

## Logs, erreurs et tests

Chaque opération importante doit laisser une trace utile : début, résultat et
erreur éventuelle. Ne jamais utiliser de `catch` vide et ne jamais journaliser
mot de passe, token, secret, URI MongoDB complète ou contenu privé.

Tester les cas nominaux et les erreurs : données invalides, absence de JWT,
ressource inexistante, doublon, fichier trop grand et mauvais type. Vérifier le
code HTTP, le JSON, les effets dans MongoDB ou sur le disque, puis lire les logs
du backend.

## Prompt de travail recommandé

```text
Lis backend/AGENTS.md, backend/best-practices.md et les parties pertinentes de
API_CONTRACT.md. Analyse d’abord la route concernée, décris son flux et propose
les fichiers à modifier. Ne change pas le contrat API sans mettre à jour
`API_CONTRACT.md` dans la même mission et ne touche jamais aux secrets. Après
validation, implémente une modification limitée, lance les tests et signale
chaque erreur.
```
