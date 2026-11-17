# Protocole de synchronisation

Ce document décrit le canal temps réel d'un salon : état partagé, messages,
tolérances, règles de conflit et de buffering. Le contrat HTTP est dans
[API_CONTRACT.md](API_CONTRACT.md).

Code : `backend/src/realtime.js` et `backend/src/sync/` côté serveur,
`frontend-starter/src/app/shared/sync/`, `shared/services/sync.service.ts` et
`components/sync-player/` côté client.

## Principe

Le serveur est la **seule source de vérité**. Un clic sur lecture, pause ou
déplacement n'agit pas sur le lecteur local : il envoie une **commande**. Le
serveur l'horodate avec son horloge, lui donne un numéro de version, puis
diffuse le nouvel état à **tout le salon, émetteur compris**. Les lecteurs
n'appliquent que cet état partagé : tout le monde suit la même ligne de temps.

## Connexion

- Transport : Socket.IO, sur le même serveur HTTP que l'API (chemin
  `/socket.io`).
- Authentification : le **jeton de salon** est envoyé dans la poignée de main
  (`auth: { token }`). Sans jeton valide (signature, expiration, salon existant,
  participant non sorti), la connexion est refusée avec l'erreur
  `Salon fermé ou jeton invalide`.
- Le salon d'une connexion vient du jeton vérifié, jamais d'un message du
  client : une connexion ne peut agir que sur son propre salon. L'expiration du
  jeton est revérifiée à chaque commande.

## État partagé

```ts
interface PlaybackState {
  mediaId: string;
  paused: boolean;
  position: number;   // secondes, valable à `updatedAt`
  rate: number;       // vitesse de lecture, normalement 1
  updatedAt: number;  // horloge du serveur, en ms
  version: number;    // augmente à chaque changement
}
```

Position où chaque client doit se trouver :

```text
attendu = paused ? position : position + (serverNow() - updatedAt) / 1000 * rate
```

Quand aucun média n'est chargé, `playback` vaut `null`.

## Messages

### Serveur → client

| Événement | Contenu | Quand |
|---|---|---|
| `room:state` | `{ version, playback, waitingFor, participants, serverTime }` | Juste après chaque connexion : un arrivant tardif démarre à la bonne position. |
| `playback:state` | `{ version, playback, waitingFor, action, by }` | À chaque changement. `action` : `load`, `play`, `pause`, `seek`, `ended`, `buffering`, `resume`, `unload`. `by` : `{ id, name }` de l'auteur, ou `null` si le serveur a agi seul. |
| `room:participants` | `[{ id, name }]` | Liste des participants connectés, à chaque arrivée ou départ. |
| `media:changed` | - | Un média a été ajouté ou supprimé : recharger la liste. |
| `room:updated` | `Room` | L'hôte a changé le code du salon. |
| `room:closed` | `{ reason }` | Le salon n'est plus accessible, puis la connexion est fermée. `reason` : `closed` (fermé par l'hôte ou expiré), `left` (ce participant a quitté le salon, par exemple dans un autre onglet du même navigateur), `expired` (jeton de salon expiré). |

### Client → serveur

| Événement | Contenu | Réponse |
|---|---|---|
| `clock:ping` | accusé de réception | `{ serverTime }` |
| `playback:command` | une commande (ci-dessous) + accusé de réception | `{ ok: true }` ou `{ ok: false, message }` |
| `buffer:start` | - | Le lecteur est bloqué depuis plus de 0,5 s. |
| `buffer:end` | - | Le lecteur peut de nouveau lire. |

Commandes :

| Commande | Effet |
|---|---|
| `{ type: "load", mediaId }` | Charge un média du salon, en pause à 0 s. Refusée (`Média inconnu`) si le média n'appartient pas au salon. |
| `{ type: "play" }` | Lecture à partir de la position courante. |
| `{ type: "pause" }` | Pause à la position attendue à l'heure du serveur. |
| `{ type: "seek", position }` | Déplace tout le salon. L'état lecture/pause est conservé. Refusée (`Position invalide`) si `position` n'est pas un nombre fini positif. |
| `{ type: "ended", version, position }` | Fin du média : le salon passe en pause. Seul le premier signalement, émis pour la version courante, est pris en compte. |

## Règles

1. **Décalage d'horloge.** À chaque connexion, le client envoie 5 `clock:ping` et
   garde la mesure dont l'aller-retour est le plus court (méthode de type NTP) :
   `offset = serverTime + allerRetour / 2 - heureDeRéception`, puis
   `serverNow() = Date.now() + offset`.
2. **Les commandes passent par le serveur.** Les clients n'appliquent que l'état
   diffusé, y compris pour leurs propres clics.
3. **Messages périmés.** Un client écarte un `playback:state` dont la version est
   inférieure à celle qu'il connaît. À version égale, seule la liste d'attente
   (`waitingFor`) est mise à jour. Un `room:state` est toujours accepté : après un
   redémarrage du serveur, les versions repartent de 0.
4. **Correction de la dérive**, environ une fois par seconde pendant la lecture :

   | Écart avec la position attendue | Action |
   |---|---|
   | moins de 0,1 s | rien |
   | de 0,1 s à 1 s | vitesse × 1,05 (en retard) ou × 0,95 (en avance), jusqu'à revenir sous 0,03 s |
   | plus de 1 s | saut à la position attendue |

   En pause, le lecteur est recalé dès que l'écart dépasse 0,05 s.
5. **Pas de boucle d'écho.** Le lecteur n'a pas les contrôles natifs du
   navigateur. Les boutons envoient des commandes ; les événements `play`,
   `pause` et `seeked` du lecteur ne sont jamais renvoyés au serveur.
6. **Buffering : le salon attend le participant le plus lent.**
   - Un blocage de moins de 0,5 s est ignoré (il y en a après chaque lecture et
     chaque saut).
   - Au-delà, le client envoie `buffer:start`. Le serveur met le salon en pause
     (`action: "buffering"`) et note qui il attend (`waitingFor`).
   - Quand tous ont envoyé `buffer:end`, le serveur relance la lecture
     (`action: "resume"`).
   - **Limite de 10 s.** Un participant encore bloqué après 10 s ne retient plus
     le salon, qui repart sans lui. Ses nouveaux `buffer:start` sont ignorés
     jusqu'à son prochain `buffer:end` ; la correction de dérive le ramène
     ensuite à la bonne position.
   - Un participant qui se déconnecte est retiré de la liste d'attente.
   - Pendant l'attente : `pause` annule la reprise automatique, `play` relance
     tout de suite (les participants bloqués rattraperont seuls), `seek` déplace
     le salon qui continue d'attendre.
   - Une pause décidée par un participant n'attend personne : les `buffer:start`
     sont alors ignorés.
7. **Lecture automatique.** Les navigateurs bloquent la lecture avec son tant
   que l'utilisateur n'a pas interagi avec la page. Si `play()` est refusé (par
   exemple après un rechargement), le lecteur affiche un bouton « Cliquer pour
   rejoindre la lecture du salon » et ne signale pas de buffering.
8. **Tout le monde contrôle la lecture, tout le monde suit.** Chaque changement
   affiche une notice indiquant son auteur (« Alex est allé à 12:34 »). Si deux
   commandes se croisent, la dernière reçue par le serveur gagne.
9. **Arrivants tardifs.** `room:state` donne l'état courant dès la connexion.
10. **Salon vide.** Quand plus personne n'est connecté, la lecture passe en pause
    à la position courante.

## Limites connues

- L'état des salons est **en mémoire** : il convient à une seule instance de
  serveur et se perd à chaque redémarrage (les lecteurs repartent sans média
  chargé, il suffit d'en choisir un).
- La tolérance visée est de **0,5 s** entre participants distants. La
  synchronisation au niveau de l'échantillon, pour plusieurs enceintes dans une
  même pièce, n'est pas un objectif.
- Le serveur ne connaît pas la durée des médias : il s'appuie sur le
  signalement `ended` des lecteurs.
