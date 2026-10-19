  # Préparation MongoDB Atlas - TP1

Cette partie est réalisée une fois par binôme. Ne copiez jamais l'URI dans Angular, Git, une capture d'écran ou un prompt envoyé à un agent IA.

## 1. Créer le cluster

1. Créez un compte sur MongoDB Atlas (https://www.mongodb.com/  )
2. Créez un projet nommé `Guitar Practice Cloud`. Il se peut que vous deviez d'abord créer une organisation puis un projet dans l'organisation.
3. Déployez un cluster gratuit.
4. Attendez que son état permette la connexion.

Vous pouvez regarder les transparents du cours Angular : https://docs.google.com/presentation/d/1Z6-lyeMALH-pLg1pMFXzfJ8ZGz6TL3dYytved0445jc/edit?usp=sharing à partir du No 218, arrêtez-vous juste après la création du cluser.

Documentation officielle : https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/

Une fois le cluster créé il vous propose un user (qui est admin) et un password, et aussi de télécharger un fichier .env, téléchargez-le il contiendra vos informations

Vous pouvez aussi créer un utilisateur "à la main" (étape 2 facultative)

## 2. Créer un utilisateur custom (facultatif)

Cet utilisateur est différent du compte utilisé pour ouvrir le site Atlas. Ouvrez `Security/Database & Database Access`, créez un utilisateur et donnez-lui les droits de lecture et d'écriture nécessaires (dans le "rôle" choisissez "Read & Write to any Database" ou "Atlas Admin"). Pour éviter les erreurs d'encodage pendant ce TP, utilisez un mot de passe robuste composé de lettres et de chiffres. Dans un vrai projet, les caractères spéciaux sont recommandés mais doivent être encodés dans l'URI.

## 3. Autoriser la connexion réseau

Dans `Network Access`, ajoutez votre adresse IP actuelle. Si Atlas le propose, rendez cette autorisation temporaire pour la durée du TP. Vous poiuvez ajouter `0.0.0.0/0`, qui autorise les tentatives depuis tout Internet. Pour une vraie application on devrait changer cela et n'autoriser que les connexions depuis votre futur front end hébergé lui aussi dans le cloud ou en local sur votre machine.

## 4. Récupérer l'URI Node.js
Retournez dans le menu principal à gauche et cliquez "Database/Cluster"

Dans la fenêtre principale cliquez sur le bouton `Connect`, choisissez la connexion par driver, puis Node.js. L'URI ressemble à :

```text
mongodb+srv://<user>:<db_password>@cluster0.l7fl28o.mongodb.net/?appName=Cluster0
```

## 5. Configurer le backend

Dans le dossier `backend` :

```bash
cp .env.example .env
```

Et remplacez l'URI de connexion par celui que vous avez généré dans l'étape 4, ou dans atlas-credentials.env que vous aurez téléchargé dans l'étape 1. Attention, so vous aviez créé un utilisateur custom dans l'étape 2, il faudra mettre son login et son password. Vous remplacerez bien sur <user> et <password> par les login et password. Attention, NE PAS LAISSER les signes inférieur et supérieur.

IMPORTANT: juste avant le ? dans l'URI, vous ajouterez le nom de la base de données. On prendra par exemple guitar-practice-cloud, l'URI doit donc ressembler à mongodb+srv://<user>:<db_password>@cluster0.l7fl28o.mongodb.net/guitar-practice-cloud?appName=Cluster0

Remplacez les trois marqueurs de l'URI et choisissez une valeur locale longue pour `JWT_SECRET`. Vérifiez avec `git status` que `.env` n'apparaît pas parmi les fichiers à versionner.

## 6. Tester

```bash
npm install
npm start
```

Ouvrez `http://localhost:3000/api/health`. Ca doit afficher {"status":"ok"}, ce qui prouve que le back-end nodeJS répond. Ca ne prouve pas que la connexion à la base de données s'est bien passée et que les données ont bien été créées.

Normalement, le backend crée automatiquement le compte `demo@example.com` / `Demo1234!`. 

Retournez sur la page web de mongodb.com et cliquez le bouton "browse collections" qui est dans l'affichage du cluster. Ca doit vous mener vers un écran ou sur la gauche vous pouvez ouvrir le contenu de "cluster0", et vous devriez voir dans la liste qui s'affiche en dessous plusieurs bases de données dont guitar-practice-cloud. Si vous l'ouvre vous verrez à l'intérieur deux collections : tracks et users. Ce sont l'équivalent des tables dans une BD relationnelle. Cliquez sur "users" et vous devriez voir un user qui a été créé par défaut, qui a pour nom "demo". Vous pourrez voir son nom en clair dans le code source du back-end (fichier server.js)

Une fois que tout cela a fonctionné, vous pourrez lancer le front-end angular qui vous est fourni. Retournez dans le fichier `SUJET_ETUDIANT.md`

## Diagnostic rapide

- `authentication failed` : utilisateur, mot de passe ou encodage incorrect ;
- `IP not in access list` ou timeout : règle `Network Access` incorrecte ;
- fichier `.env` absent : refaire `cp .env.example .env` ;
- URI publiée par erreur : changer immédiatement le mot de passe de l'utilisateur de base.
