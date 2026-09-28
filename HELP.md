# Aide — Lancer le projet Guitar Practice Cloud

Ce fichier résume tout ce qu'il faut pour relancer le projet (backend +
frontend) après un redémarrage, une fermeture des terminaux, etc. Il n'est
pas demandé par le sujet : c'est juste un aide-mémoire personnel.

## Prérequis (déjà en place)

- Node.js **v22.22.3 ou plus récent** (vérifié : v22.23.2 installé via
  `winget upgrade OpenJS.NodeJS.22`). Vérifier avec :

  ```bash
  node -v
  ```

  Si la version est trop ancienne, `ng serve`/`ng build` refusent de démarrer.

- `backend/.env` déjà créé et rempli avec l'URI MongoDB Atlas et un
  `JWT_SECRET` généré aléatoirement. **Ne jamais committer ce fichier**
  (vérifier avec `git status` qu'il n'apparaît pas).

- **Ne pas utiliser PowerShell** comme terminal pour ce projet (consigne du
  cours) : utiliser Git Bash.

## 1. Démarrer le backend

Dans un premier terminal :

```bash
cd backend
npm install       # seulement si node_modules a été supprimé
npm start
```

Le backend écoute sur `http://localhost:3000`. Vérifier qu'il répond :

```bash
curl http://localhost:3000/api/health
# doit répondre {"status":"ok"}
```

Au démarrage, il doit afficher dans le terminal :

```text
[startup] Connecté à MongoDB Atlas
[startup] La base guitar-practice-cloud est prête à recevoir des données
[startup] Compte de démonstration déjà présent   (ou "créé" la première fois)
Guitar Practice Cloud API: http://localhost:3000/api/health
```

Si ça affiche une erreur de connexion MongoDB à la place : vérifier
`backend/.env` (URI, mot de passe, IP autorisée dans Atlas → Network Access).

## 2. Démarrer le frontend

Dans un **second** terminal (laisser le premier tourner) :

```bash
cd frontend-starter
npm install       # seulement si node_modules a été supprimé
npm start
```

Ouvrir ensuite `http://localhost:4200` dans le navigateur.

### Si `npm install` échoue avec une erreur `Cannot read properties of null (reading 'edgesOut')`

C'est un bug connu de npm avec la résolution des dépendances (peer deps).
Solution :

```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

## 3. Se connecter

Compte de démonstration :

- email : `demo@example.com`
- mot de passe : `Demo1234!`

Ou créer un compte via la page d'inscription.

## 4. Arrêter les serveurs

Dans chaque terminal, `Ctrl + C`.

## Résumé express (une fois que tout est configuré)

```bash
# Terminal 1
cd backend && npm start

# Terminal 2
cd frontend-starter && npm start

# Navigateur
http://localhost:4200
```

## Dépannage rapide

| Symptôme | Cause probable | Solution |
|---|---|---|
| `ng serve`/`ng build` refuse de démarrer, erreur de version Node | Node trop ancien | `winget upgrade OpenJS.NodeJS.22` (ou réinstaller Node ≥ 22.22.3) puis ouvrir un nouveau terminal |
| `Cannot read properties of null (reading 'edgesOut')` pendant `npm install` | Bug npm/Arborist avec les peer deps | `rm -rf node_modules package-lock.json && npm install --legacy-peer-deps` |
| Backend : `Échec de connexion à MongoDB` | URI/mot de passe incorrect, ou IP non autorisée | Vérifier `backend/.env`, vérifier Atlas → Network Access → IP Access List |
| Page blanche ou erreurs CORS/404 sur `/api/...` | Backend non démarré, ou `proxy.conf.json` mal configuré | Vérifier que le backend tourne sur le port 3000 et que `frontend-starter/proxy.conf.json` pointe vers `http://localhost:3000` |
| `401` sur toutes les requêtes après un moment | Token JWT expiré (durée de vie : 2h) | Se reconnecter ; l'app redirige maintenant automatiquement vers `/login` dans ce cas |
| Upload refusé avec un message d'erreur | Format non supporté (seuls MP3, WAV, OGG, M4A) ou fichier > 25 Mo | Vérifier le fichier utilisé, essayer ceux de `frontend-starter/fichiers-audio-de-test/` |
