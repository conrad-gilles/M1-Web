# TP3 — Fiabilisation et enrichissement du frontend

## Objectif

Faire évoluer une application Angular existante sans casser les fonctionnalités des TP1 et TP2. Vous allez ajouter une fonctionnalité métier, gérer une opération asynchrone plus précisément et écrire des tests automatisés.

Durée maximale : 2 heures. Travail en binôme. L’usage d’un assistant IA est autorisé, mais chaque membre doit pouvoir expliquer le code et les tests produits.

## Prérequis

Les TP1 et TP2 doivent être fonctionnels : connexion, profil, pagination, upload et lecture audio. Le backend fourni reste inchangé pour les missions obligatoires.

Relire `API_CONTRACT.md`. Les flux étudiés dans ce TP sont :

```text
card de piste → TrackService → HttpClient → DELETE /api/tracks/:id
formulaire d’upload → TrackService → HttpClient → événements de progression
tests → services/composants isolés → réponses HTTP simulées
```

## Déroulement conseillé

| Temps | Activité | Production attendue |
|---|---|---|
| 0:00–0:15 | Lecture du code et des tests existants | manques identifiés |
| 0:15–0:50 | Suppression d’une piste | suppression confirmée et interface rafraîchie |
| 0:50–1:20 | Progression de l’upload | pourcentage et états visibles |
| 1:20–1:50 | Tests automatisés | tests reproductibles |
| 1:50–2:00 | Build, Network et restitution | preuves finales |

## Mission 5 — Suppression d’une piste

Le backend fournit déjà l’endpoint suivant :

```http
DELETE /api/tracks/:id
```

Ajouter côté frontend :

- une action « Supprimer » dans chaque card ;
- une confirmation avant suppression ;
- un état de suppression pour éviter les doubles clics ;
- un message de succès ou d’erreur (composant Angular SnackBar);
- Mise à jour du contenu de la page après suppression ;
- la gestion du cas où la piste n’existe plus (elle est affichée à l'écran mais a été supprimée entre temps, par exemple dans un autre onglet) ou n’appartient pas à l’utilisateur.

Identifier d’abord le composant et le service concernés. Le composant ne doit pas appeler directement `HttpClient` : l’appel doit passer par `TrackService`.

Expliquer pourquoi le guard Angular et l’interface ne suffisent pas à sécuriser la suppression. C’est le backend qui vérifie réellement le JWT et le propriétaire de la piste.

## Mission 6 — Progression de l’upload

Faire évoluer l’upload existant pour afficher sa progression. Utiliser les événements HTTP Angular et distinguer au minimum :

- l’absence d’upload en cours ;
- l’upload en cours avec un pourcentage ;
- la réussite ;
- l’échec.

Pendant l’envoi, désactiver les contrôles concernés et empêcher une seconde soumission. Ne jamais afficher le mot de passe ni le JWT dans la console ou dans l’interface.

Expliquer pourquoi un upload avec progression ne se traite pas exactement comme une requête HTTP qui émet uniquement une réponse finale.

## Mission 7 — Tests automatisés

Le frontend-starter ne fournit pas encore de véritable suite de tests de composants et de services. Le backend contient seulement des tests de santé et de schéma. Ajoutez des tests ciblés, sans remplacer les tests existants.

### Tests frontend obligatoires

Écrire au moins trois tests parmi les suivants :

- `AuthService.login()` utilise `POST /api/auth/login` avec le bon corps ;
- `TrackService.list()` transmet `page` et `limit` ;
- l’intercepteur ajoute `Authorization` lorsqu’un token existe ;
- le guard redirige un utilisateur sans token ;
- le composant affiche une erreur après un échec HTTP ;
- la suppression appelle `DELETE /api/tracks/:id` et recharge la liste ;
- l’upload met à jour l’état de progression et traite l’erreur.

Les tests doivent vérifier les URL, méthodes, paramètres, headers et résultats simulés. Ils ne doivent pas dépendre d’un backend ou d’une base MongoDB en fonctionnement.

### Extension backend facultative

À partir de `backend/test/api.test.js`, ajouter des tests de contrat ou de sécurité pour :

- une réponse `401` sans JWT ;
- une réponse `401` avec un JWT invalide ;
- un upload sans fichier ;
- un type MIME refusé ;
- une pagination avec `page` et `limit` ;
- l’accès interdit à la piste d’un autre utilisateur.

Cette extension ne nécessite pas de modifier les routes du backend. Elle vérifie que le contrat reste respecté.

## Vérifications finales

Lancer les tests frontend et backend disponibles, puis :

```bash
npm run build
```

Dans l'onglet Network des devtools du navigateur, vérifier au minimum :

- une requête `DELETE` après confirmation ;
- une requête d’upload et ses événements de progression.

Dans la console, vérifier qu’aucune erreur inattendue ne reste affichée et qu’aucune donnée sensible n’est journalisée.

## Restitution orale

Chaque membre doit pouvoir expliquer :

1. pourquoi la suppression passe par un service ;
2. comment le backend protège la suppression ;
3. comment Angular calcule le pourcentage d’upload ;
4. pourquoi les tests HTTP n’ont pas besoin de MongoDB ;
5. ce que vérifie un test d’intercepteur ou de guard ;
6. quelle différence existe entre un test unitaire et un test d’intégration.

## Livrables TP3

- suppression fonctionnelle d’une piste ;
- progression d’upload ou, à défaut, état d’upload correctement géré ;
- au moins trois tests frontend ;
- rapport des tests avec résultats attendus et observés ;
- capture Network d’une suppression et d’un upload ;
- `npm run build` exécuté ;
- rapport IA fondé sur `RAPPORT_IA_MODELE.md`.

Une fonctionnalité non expliquée ou un test qui ne vérifie aucune assertion utile ne permet pas de valider la mission.
