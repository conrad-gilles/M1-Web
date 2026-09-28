# Conseils pour utiliser un assistant IA pour coder

Ce document explique comment utiliser un assistant IA comme un véritable outil
de développement pendant les TP. L’objectif n’est pas seulement de copier du
code produit par un chatbot : il faut apprendre à donner du contexte, vérifier
les propositions, faire des essais et conserver la responsabilité du code.

## 1. Choisir le bon mode d’utilisation

### Notre recommandation

Nous déconseillons d’utiliser les chatbots en mode web comme outil principal de
développement. Ils sont très utiles pour des discussions générales, par
exemple :

- « Explique-moi le concept de service en Angular. » ;
- « Qu’est-ce que l’API `FormData` des navigateurs ? » ;
- « Qu’est-ce que le module npm `multer` ? » ;
- « Quelle est la différence entre un `Observable` et une `Promise` ? ».

Dès qu’il faut travailler sur les fichiers du projet, qu’il s’agisse du code
source, des tests, de la configuration ou de la documentation, utilisez un
outil capable de gérer un projet et son contexte :

- un outil en ligne de commande, lancé par exemple dans le terminal de VS Code ;
- une application capable d’ouvrir un projet, comme Codex App, Gemini App ou
  Claude App ;
- un IDE « AI first » pour le développement, comme Cursor, Antigravity ou
  Windsurf ;
- une extension d’IDE disposant d’un accès explicite au workspace, comme
  GitHub Copilot dans VS Code.

L’objectif est que l’assistant puisse examiner les fichiers pertinents, suivre
les instructions du projet, proposer un diff limité et vous aider à lancer les
vérifications. Copier-coller un fichier dans un chatbot web doit rester une
solution ponctuelle, par exemple lorsqu’aucun outil de projet n’est disponible
ou pour demander une explication isolée.

### Comparaison rapide

| Approche | Avantages | Inconvénients et précautions |
| --- | --- | --- |
| Chatbot web | Très accessible ; bon pour apprendre un concept, comparer des solutions ou reformuler une erreur | Ne connaît pas forcément le dépôt ; copier-coller manuel ; risque d’oublier un fichier ou une contrainte ; modifications manuelles et difficiles à tracer |
| CLI dans un terminal | Accès direct au projet ; commandes, tests, build et logs ; historique clair ; adapté aux tâches répétitives | Demande de comprendre le terminal ; l’agent peut modifier plusieurs fichiers ou exécuter des commandes : vérifier les autorisations et le diff |
| Application de projet | Vue d’ensemble du dépôt ; conversation, fichiers modifiés et validations réunis au même endroit ; bonne expérience pour une mission complète | Fonctionnalités et prix variables ; accès au dépôt et permissions à contrôler ; risque de laisser l’agent travailler sur un périmètre trop large |
| Extension VS Code / Copilot | Le code et les suggestions sont proches de l’éditeur ; acceptation par ligne ou bloc ; intégration au workflow quotidien | Le contexte effectivement envoyé peut être limité ; certaines suggestions ne lisent pas toutes les consignes ; il faut revoir chaque modification |
| IDE AI first | Navigation, édition, recherche et conversation intégrées ; pratique pour explorer rapidement une base de code | Outil plus intrusif et parfois payant ; comportement variable selon le modèle ; éviter les refactorings globaux non demandés |

Quel que soit l’outil, vous devez savoir quels fichiers ont été lus, quels
fichiers ont été modifiés, quelles commandes ont été exécutées et comment le
résultat a été vérifié.

## 2. Les différents modes d’utilisation

Vous pouvez utiliser l’outil qui vous convient, à condition de pouvoir accéder
aux fichiers du projet et d’être capable de vérifier les modifications.

### Interface web

ChatGPT, Claude ou Gemini dans un navigateur peuvent expliquer du code et
proposer des modifications. Mais une conversation web classique ne lit pas
forcément votre dépôt Git automatiquement. Il faut généralement :

1. joindre les fichiers nécessaires, ou copier les extraits utiles ;
2. fournir le message d’erreur complet et le contexte de la modification ;
3. appliquer soi-même la proposition dans VS Code ;
4. relire le diff et lancer les commandes de vérification.

Ne copiez pas tout le projet dans chaque message. Commencez par les fichiers
directement concernés, puis ajoutez progressivement les dépendances utiles.

### Extension d’IDE ou assistant intégré

Copilot, les extensions Claude, Gemini ou autres assistants intégrés à VS Code
peuvent lire le workspace ouvert et proposer des modifications directement dans
les fichiers. Vérifiez toujours le périmètre de la modification : sélection de
code, fichier courant ou projet entier. Examinez le diff avant de l’accepter.

### Application desktop ou agent de code

Les applications comme Claude Desktop, Codex App ou les applications Gemini
peuvent fonctionner avec un dossier de projet. Elles sont particulièrement
pratiques pour demander une analyse du dépôt, exécuter des tests et modifier
plusieurs fichiers. Il faut néanmoins contrôler les autorisations demandées et
les fichiers effectivement modifiés.

### Ligne de commande (CLI)

Claude Code, Codex CLI et Gemini CLI travaillent directement dans un dossier
ouvert depuis le terminal. Ils peuvent lire les instructions du projet, lancer
des commandes et modifier les fichiers selon les autorisations accordées.

Lancez l’outil dans le dossier pertinent, par exemple :

```bash
cd frontend-starter
claude
```

ou :

```bash
cd frontend-starter
gemini
```

Les noms de commandes et leurs options peuvent varier selon la version et
l’installation. Consultez l’aide de l’outil utilisé.

## 3. Les fichiers d’instructions du projet

Le starter contient plusieurs fichiers afin de fonctionner avec plusieurs
assistants :

```text
frontend-starter/
├── AGENTS.md
├── CLAUDE.md
├── GEMINI.md
└── best-practices.md
```

NOTE : j'ai demandé à mon propre assistant de générer ces fichiers dans le projet "Ajoute au projet les fichiers ./md nécessaires pour le développement logiciels à l'aide d'asssistants IA comme codex, claude ou gemini. Ajoute les bonnes pratiques pour du développement en Angular 22. Va chercher sur le web ces bonnes pratiques en donnant la priorité aux ressources provenant des ressources officielles fournies par les équipes ayant créé Angular. J'ajoute que quand du code est générée je voudrais qu'il soit commenté de manière détaillée à l'attention d'étudiants de 
Master 1, parfois débutants en Angular et TypeScript."

J'ai fait pareil pour le projet backend en demandant des bonnes pratiques pour le développement Node/Express/MongoDB/Mongoose.

### `AGENTS.md`

Ce fichier contient les règles générales destinées aux agents de
programmation, notamment Codex. Il rappelle l’architecture Angular, les
contraintes de formatage, les vérifications à effectuer et les interdictions
importantes.

### `CLAUDE.md`

Ce fichier contient les consignes spécifiques à Claude Code. Il renvoie aussi
vers `AGENTS.md` et `best-practices.md` afin d’éviter de dupliquer toutes les
règles.

### `GEMINI.md`

Ce fichier contient les consignes spécifiques à Gemini CLI. Il renvoie lui
aussi vers les règles communes et rappelle les contraintes essentielles.

### `best-practices.md`

Ce fichier décrit les bonnes pratiques Angular et TypeScript attendues dans le
TP. Il n’est pas forcément détecté automatiquement par tous les assistants :
les fichiers `AGENTS.md`, `CLAUDE.md` et `GEMINI.md` demandent donc explicitement
de le lire.

## 4. Lecture automatique : ce qui est garanti ou non

La lecture automatique dépend de l’outil et du répertoire depuis lequel il est
lancé. Les conventions les plus courantes sont :

| Outil ou mode | Fichier à présenter en priorité |
| --- | --- |
| Codex CLI ou intégration Codex | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| ChatGPT, Claude ou Gemini dans un navigateur | lecture manuelle ou fichier joint |
| Extension VS Code | dépend de l’extension et du workspace ouvert |

Même lorsqu’un fichier est normalement chargé automatiquement, demandez à
l’assistant de confirmer les instructions qu’il a prises en compte. Un fichier
Markdown ordinaire n’est pas une commande magique : son nom, son emplacement et
le mode d’utilisation de l’assistant sont importants.

## 5. Prompt recommandé pour commencer une mission

Utilisez ce prompt au début de chaque mission, en l’adaptant à votre outil :

```text
Tu es mon assistant de développement pour ce projet Angular 22.

1. Lis les fichiers d’instructions adaptés à ton outil : AGENTS.md,
   CLAUDE.md ou GEMINI.md, ainsi que best-practices.md.
2. Lis le README et les parties pertinentes de API_CONTRACT.md.
3. Analyse d’abord le code existant sans le modifier.
4. Résume les fichiers concernés et le flux composant -> service -> HttpClient -> API.
5. Indique les routes API et les modèles utilisés.
6. Propose une modification limitée à la mission demandée.
7. Attends ma validation avant une modification importante ou une refonte.
8. Après modification, explique les changements, les tests lancés et les erreurs
   éventuelles. Ne masque jamais une erreur.

Mission : [décrire précisément la mission du TP]
```

Pour une interface web qui ne lit pas automatiquement les fichiers, ajoutez :

```text
Je joins les fichiers AGENTS.md, best-practices.md, README.md et
API_CONTRACT.md. Lis-les avant de répondre et cite les règles qui concernent
ma mission.
```

## 6. Une bonne demande contient du contexte

Une demande efficace précise :

- l’objectif fonctionnel observable ;
- les fichiers que vous pensez concernés ;
- ce qui existe déjà et ne doit pas être recréé ;
- les contraintes techniques du sujet ;
- le message d’erreur complet, le cas échéant ;
- la commande utilisée et son résultat ;
- le résultat attendu.

Exemple :

```text
Dans tracks-page, je veux afficher la page suivante lorsque l’utilisateur
clique sur “Suivant”. Commence par analyser le composant et TrackService.
Respecte API_CONTRACT.md, conserve les Signals et utilise @if/@for. Ne modifie
pas le backend. Propose d’abord les fichiers à changer et explique le flux HTTP.
```

## 7. Vérifier le code proposé

L’assistant peut produire du code plausible mais incorrect. Pour chaque
modification :

1. lisez le diff ligne par ligne ;
2. vérifiez les imports, les types et les noms de propriétés ;
3. vérifiez que l’URL HTTP, la méthode et le corps correspondent à
   `API_CONTRACT.md` ;
4. vérifiez le comportement avec un cas nominal et un cas d’erreur ;
5. lancez le build et les tests disponibles ;
6. ouvrez les DevTools et examinez l’onglet Network ;
7. vérifiez la console et les logs du backend ;
8. demandez à l’assistant d’expliquer les choix qu’il a faits.

Dans ce TP, une requête HTTP importante doit avoir un traitement explicite du
succès et de l’erreur. Un `catch` vide ou une erreur ignorée rend le diagnostic
beaucoup plus difficile.

## 8. Travailler par petites étapes

Évitez les demandes vagues comme « améliore toute l’application ». Procédez par
petits changements : un formulaire, un service, un affichage, une validation ou
un test à la fois. Après chaque étape :

- observez le diff ;
- lancez la vérification appropriée ;
- testez dans le navigateur ;
- notez ce qui fonctionne et ce qui reste à faire.

Si l’assistant modifie trop de fichiers, annulez ou corrigez cette proposition
avant de poursuivre et reformulez la demande avec un périmètre plus précis.

## 9. Sécurité et confidentialité

Ne transmettez jamais à un assistant :

- un mot de passe MongoDB Atlas ;
- un secret JWT ;
- un fichier `.env` réel ;
- un token d’accès personnel ;
- des données personnelles ou des fichiers privés inutiles au TP.

Utilisez des valeurs fictives ou les fichiers `.env.example`. Le secret JWT
reste dans le backend et ne doit jamais être placé dans Angular.

## 10. Choisir le modèle et la capacité de raisonnement

Le modèle le plus puissant n’est pas toujours le meilleur choix. Choisissez en
fonction de la tâche :

- un modèle rapide et économique pour expliquer une notion, générer un petit
  exemple ou reformuler un message d’erreur ;
- un modèle généraliste de bon niveau pour modifier un composant, écrire un
  service ou analyser quelques fichiers ;
- un modèle avec une capacité de raisonnement élevée pour comprendre plusieurs
  fichiers liés, diagnostiquer un bug difficile, concevoir une architecture ou
  comparer plusieurs solutions.

La capacité de raisonnement peut améliorer les problèmes complexes, mais elle
augmente souvent le temps de réponse, la consommation et parfois le coût. Elle
ne remplace jamais les tests. Commencez avec un modèle raisonnable, puis
augmentez la capacité si le problème est réellement difficile.

Vous pouvez demander conseil à l’assistant au lieu de choisir au hasard :

```text
Voici ma mission, les fichiers concernés et le message d’erreur. Compare les
modèles disponibles dans mon outil pour cette tâche. Recommande le modèle et
le niveau de raisonnement adaptés, explique le compromis qualité / temps / coût,
et indique pourquoi un modèle plus simple pourrait ou non suffire. Ne modifie
aucun fichier.
```

Pour un problème complexe :

```text
Avant de coder, estime la difficulté de cette mission. Dis-moi si elle demande
une analyse multi-fichiers ou un raisonnement approfondi. Propose deux options :
un modèle rapide et un modèle plus capable. Explique ce que je risque de perdre
avec l’option rapide et comment vérifier le résultat.
```

Pour apprendre plutôt que déléguer :

```text
Ne me donne pas encore le code. Aide-moi à choisir le modèle adapté et pose-moi
les questions nécessaires. Explique ensuite une méthode de résolution que je
pourrai appliquer et vérifier moi-même.
```

### À propos des tokens consommés

Un token est une unité de texte utilisée par le modèle ; ce n’est pas
exactement un mot. Les tokens comprennent le prompt, les fichiers transmis,
le contexte de la conversation et la réponse. Un long historique ou un grand
nombre de fichiers peut donc augmenter la consommation sans que la demande
paraisse longue.

L’endroit où cette consommation est visible dépend du produit et de
l’abonnement :

- certaines interfaces affichent un compteur, une fenêtre de contexte ou une
  consommation de quota ;
- les outils CLI et les extensions peuvent afficher les statistiques dans la
  session ou dans leurs réglages ;
- les offres utilisant une API affichent généralement les consommations et les
  coûts dans le tableau de bord du fournisseur ;
- certaines applications grand public ne donnent pas le nombre exact de tokens.

Si aucun compteur n’est disponible, demandez à l’assistant d’indiquer la taille
du contexte utilisé et vérifiez les informations de quota de votre outil. Une
estimation donnée par le modèle n’est pas une mesure officielle.

Pour limiter une consommation inutile :

- ouvrez le bon sous-projet, par exemple `frontend-starter` ;
- fournissez les fichiers directement concernés et les interfaces appelées ;
- résumez les essais précédents au lieu de conserver une conversation énorme ;
- demandez une modification ciblée ;
- commencez un nouveau fil lorsqu’un ancien contexte devient confus.

## 11. À propos des skills

Les *skills* sont des ensembles d’instructions, de ressources et parfois de
scripts qui donnent à un assistant une procédure spécialisée. Ils peuvent
servir, par exemple, à produire un document, vérifier un format, analyser un
jeu de données ou suivre un workflow particulier.

Les skills ne seront pas utilisés dans les TP1, TP2 et TP3. Ils seront introduits
ultérieurement, lorsque nous aurons étudié les assistants et les workflows plus
avancés. Pour ces trois TP, concentrez-vous sur :

- les instructions du projet (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) ;
- le code réellement présent dans le dépôt ;
- `API_CONTRACT.md` et les sujets ;
- les tests, le build, les logs et l’onglet Network.

N’installez pas un skill inconnu simplement parce qu’un assistant le propose.
Lisez ses instructions, vérifiez son origine et comprenez les actions qu’il
peut effectuer avant de l’utiliser.

## 12. Ce qui est attendu dans votre rapport

Pour chaque mission, indiquez :

- l’assistant et le mode utilisés : web, VS Code, desktop ou CLI ;
- le prompt initial et les prompts importants ;
- les fichiers consultés par l’assistant ;
- les modifications acceptées et celles refusées ;
- les erreurs rencontrées et leur résolution ;
- les commandes de build et de test exécutées ;
- une capture ou une description des requêtes visibles dans Network ;
- ce que vous avez compris et vérifié vous-même.

L’utilisation d’une IA est une compétence évaluée : être capable d’expliquer,
tester et corriger le code est plus important que d’obtenir rapidement une
réponse.

## 13. Ressources officielles

Les noms de fichiers et les fonctionnalités évoluent. Consultez la
documentation de l’outil utilisé :

- [Codex et bonnes pratiques OpenAI](https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1b2-af0cfbd38630/how-openai-uses-codex.pdf) ;
- [mémoire et `CLAUDE.md` de Claude Code](https://docs.anthropic.com/en/docs/claude-code/memory) ;
- [Gemini CLI et `GEMINI.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md) ;
- [GitHub Copilot dans VS Code](https://code.visualstudio.com/docs/copilot/overview).
