# TP1 — Architecture Authentification et Profil

Ce TP long viendra s'intégrer plus tard avec une application pour s'entrainer à la guitare. Par exemple : https://mainline.i3s.unice.fr/EndUserAmp2/host/ ou encore https://mainline.i3s.unice.fr/NAM_A2_WAM/. Il pourrait aussi servir de backend à des applications comme https://vocalremover.org/ qui permettent, à partir d'un fichier audio ou d'une vidéo YouTube, de séparer les instruments d'une piste audio pour la remixer, faire du karaoké ou rejouer par-dessus. Pour le moment, nous travaillons sur un backend et un frontend Angular capables de gérer des comptes utilisateurs et l'upload, l'affichage et l'écoute de fichiers audio.

## Objectif

Construire et comprendre la partie utilisateur d’un portail Angular connecté à une API Express/Mongoose. À la fin de la séance, vous devez savoir expliquer le trajet d’une requête de connexion et afficher un profil utilisateur réactif.

Durée maximale : 2 heures. Travail en binôme. L’usage d’un assistant IA est autorisé, mais chaque membre du binôme doit pouvoir expliquer et défendre le code produit.

## Objectifs

À la fin du TP, vous saurez repérer les responsabilités d'une application Angular standalone, construire des Reactive Forms, appeler une API avec `HttpClient`, gérer un utilisateur avec des Signals et observer les échanges dans les DevTools.

## Préparation obligatoire avant la séance

Suivre `ATLAS_SETUP.md` et vérifier que le backend démarre avec votre propre fichier `backend/.env`. Tester `GET http://localhost:3000/api/health`, puis vérifier que le compte de démonstration et les collections sont créés dans MongoDB Atlas.

Tester également `frontend-starter` avec le backend lancé. Vérifier la cible de `proxy.conf.json`. Ne jamais copier l’URI MongoDB ni le secret JWT dans Angular, Git, une capture d’écran ou un prompt IA.

Dans un nouveau terminal (conseil : utilisez Git Bash comme shell dans le terminal), testez le projet frontend Angular proposé. Le fichier `proxy.conf.json` se trouve à la racine du projet frontend ; sa propriété `target` contient normalement `http://localhost:3000`. Si le backend est lancé sur un autre port, adaptez cette valeur.

Compte de démonstration : `demo@example.com` / `Demo1234!`.

Connectez-vous et uploadez quelques fichiers audio, par exemple les `.mp3` disponibles dans `frontend-starter/fichiers-audio-de-test`. Vérifiez les requêtes dans les DevTools, onglet Network, filtre XHR/fetch. Où se trouvent les traces du backend et comment les voir ?

## Situation et architecture

Le Guitar Amp Host permet de jouer de la guitare dans le navigateur. Le portail Angular constitue son espace cloud : compte utilisateur, profil et bibliothèque audio.

Le flux étudié est :

```text
composant Angular → service Angular → HttpClient → API Express → MongoDB
```

Angular ne dialogue jamais directement avec MongoDB. Les routes et les formats attendus sont décrits dans `API_CONTRACT.md`.

## Déroulement conseillé

| Temps | Activité | Production attendue |
|---|---|---|
| 0:00–0:15 | Vérification du projet fourni et rappel sécurité | application démarrée |
| 0:15–0:35 | Cartographie de l’application | schéma du flux login |
| 0:35–1:40 | Inscription, connexion et déconnexion | formulaire et état d’authentification |
| 1:40–1:55 | Profil et modification du nom | profil réactif |
| 1:55–2:00 | Vérification Network et bilan | une preuve Network |

## Mission 0 — Cartographier l’application

Sans modifier le code au début, retrouver :

- le composant racine ;
- la configuration des routes ;
- l’enregistrement de `HttpClient` ;
- les modèles, services et pages ;
- le mécanisme qui ajoute le JWT aux requêtes protégées.

Produire un schéma annoté du flux lors d’un clic sur « Se connecter ». Ouvrir `API_CONTRACT.md` et distinguer les routes publiques des routes protégées.

## Mission 1 — Inscription Connexion et Profil

Compléter ou réécrire la partie utilisateur du frontend :

- formulaires réactifs pour l’inscription et la connexion ;
- validations et messages d’erreur compréhensibles ;
- appels de `/api/auth/register` et `/api/auth/login` ;
- sauvegarde du JWT côté navigateur, sans jamais l’afficher dans les logs ;
- mise à jour du Signal `currentUser` ;
- redirection après une connexion ou une inscription réussie ;
- bouton de déconnexion avec nettoyage de l’état local ;
- chargement de `/api/users/me` lorsque le profil est demandé ;
- modification du nom avec `PUT /api/users/me` ;
- gestion d’un `401`, avec retour vers `/login` si le token est invalide ou expiré.

Le composant ne doit pas appeler directement `HttpClient` : il passe par `AuthService`. Utiliser `inject()` et conserver une séparation claire entre interface, service et API.

À propos, quel modèle utilisez-vous dans votre assistant IA ? Comment savoir combien vous avez consommé de tokens ? Qui peut vous conseiller quel est le meilleur modèle pour une tâche donnée ?

Questions : quelles sont les différentes routes du backend qui sont utilisées ? Soyez capables de répondre à la question : « où s'effectue la tâche “mise à jour du profil utilisateur”, dans quels fichiers côté back et côté front ? »

## Checkpoint

Dans l’onglet Network, observer au minimum :

1. une connexion réussie ;
2. une connexion refusée ;
3. une lecture ou modification de `/api/users/me`.

Pour chaque requête, relever méthode, URL, corps JSON, statut, réponse et présence éventuelle de `Authorization`. Ne jamais capturer ou transmettre un mot de passe ou un JWT.

## Livrables TP1

- code frontend complété ;
- schéma annoté du flux de connexion ;
- capture Network d’une requête d’authentification ;
- courte explication de la différence entre Signal et `localStorage` ;
- première entrée dans le rapport d’usage de l’IA si un assistant a été utilisé. VOUS DEVEZ METTRE A JOUR
LE FICHIER `RAPPORT_IA_MODELE.md` pour chaque mission en donnant des preuves : texte, copies d'écrans (ajoutez-les au projet et linkez les dans le fichier `RAPPORT_IA_MODELE.md`) qui sera à rendre lors du contrôle continu.

## Références

- `API_CONTRACT.md` ;
- `ATLAS_SETUP.md` ;
- `RAPPORT_IA_MODELE.md`.
