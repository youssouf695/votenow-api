# Audit de sécurité des retraits VoteNow

## 1. Objectif

Évaluer le circuit de retrait des fonds des organisateurs sur `main` (`e4060be`), de la réservation du solde à la confirmation KPay.

## 2. Analyse et constats

### Élevée

- **Fonds réservés sans reprise applicative de l'envoi — démontré.** `src/controllers/adminController.js:448,452-475` et `src/services/kpayOperations.js:215-244`. L'approbation enregistre le retrait en `processing` avant l'appel KPay. Une interruption peut laisser l'opération en `CREATED` ou `INITIATING`. Une nouvelle approbation retourne le retrait sans reprendre l'envoi, l'annulation exige l'état `pending` et la vérification administrative exige une référence KPay déjà enregistrée (`src/controllers/withdrawalController.js:145-152`, `src/services/transactionAudit.js:89-96`). L'organisateur ne peut alors ni récupérer la réservation ni ouvrir un autre retrait. **Correction recommandée.** Prévoir une reprise persistante des opérations jamais envoyées et un rapprochement des envois incertains par référence externe avant tout renvoi ou remboursement.

### Moyenne

- **Retraits historiques sans bénéficiaire revalidé — démontré dans le code, présence en production non vérifiée.** `src/services/kpayOperations.js:37-55,221-236`. La vérification de propriété, de validation par email et de concordance des coordonnées au départ du transfert s'applique à la politique V2. Le chemin historique conserve les coordonnées du retrait pour l'envoi sans cette vérification. Un retrait historique encore en attente peut donc partir vers une destination dont la validation n'est pas établie. **Correction recommandée.** Exiger une revalidation explicite avant tout envoi historique restant ou permettre une annulation avec restitution atomique.
- **Suspension du compte sans effet sur l'approbation d'un retrait déjà réservé — démontré.** `src/middleware/auth.js:20-24`, `src/services/transactionAudit.js:74-81`, `src/controllers/adminController.js:452-473`. Le middleware contrôle le compte de l'appelant. Le traitement administratif ne vérifie pas la suspension de l'organisateur, ce qui permet à une demande en attente de poursuivre son traitement après sa suspension. **Correction recommandée.** Définir l'effet de la suspension sur les retraits en cours et, si elle doit bloquer les envois, contrôler l'éligibilité de l'organisateur lors de la prise en charge transactionnelle.
- **Ordre de verrouillage inversé entre annulation et rejet — démontré par lecture.** `src/controllers/withdrawalController.js:147-152`, `src/controllers/adminController.js:452-458`. L'annulation verrouille le compte puis le retrait. Le rejet verrouille le retrait puis crédite le compte. Leur concurrence peut provoquer un interblocage et l'abandon d'une transaction par PostgreSQL. **Correction recommandée.** Uniformiser l'ordre des verrous dans les chemins de restitution et vérifier la concurrence en environnement isolé.
- **Garanties de confirmation KPay incomplètement vérifiées.** `src/services/kpayClient.js:15-22`, `src/services/kpayOperations.js:59-97,168-202,257-264,277-305`. L'application restitue le solde sur certains codes HTTP sans confirmation terminale indépendante. Devise, environnement, téléphone et opérateur sont contrôlés conditionnellement selon les champs reçus, et un événement signé peut établir la référence fournisseur avant la réponse d'initiation. Les garanties KPay sur les champs disponibles et sur le caractère définitif de ces refus restent à vérifier. Une mauvaise classification pourrait entraîner une restitution alors qu'un transfert a été accepté. **Correction recommandée.** Vérifier le contrat KPay, exiger les champs garantis et réserver la restitution automatique aux refus définitifs documentés ou confirmés par rapprochement.

### Faible

- **Traçabilité du solde organisateur limitée — démontré sur le circuit lu.** `src/controllers/withdrawalController.js:46-51,147-152`, `src/controllers/adminController.js:456-458`, `src/services/kpayOperations.js:193-202`, `src/services/transactionAudit.js:62-69`, `scripts/transactions.sql:26-29,48-51`. Les états des retraits et opérations sont journalisables et le traitement administratif renseigne son auteur. Les réservations et restitutions modifient directement le solde organisateur sans écriture de mouvement dédiée, ce qui limite le rapprochement comptable indépendant. **Correction recommandée.** Journaliser chaque mouvement de retrait avec sa référence, son montant et son motif dans la transaction qui modifie le solde.

## 3. Fichiers concernés et protections observées

- **Accès et propriété.** `src/routes/withdrawalRoutes.js:8-45`, `src/routes/adminRoutes.js:9-11,104-108`, `src/middleware/auth.js:13-24,30-38`. JWT vérifié, version de session, contrôle du rôle et restriction de compte. Le retrait utilise le solde de l'utilisateur authentifié, avec filtrage par organisateur pour l'historique, les détails, l'événement éventuel et l'annulation (`src/controllers/withdrawalController.js:26-51,64-65,121-123,147-152`).
- **Montant et concurrence.** Montant entier de 500 à 10 000 000 FCFA, contrôle du solde et du tarif affiché, réservation sous verrou utilisateur, retrait actif unique contrôlé sous ce verrou et clé d'idempotence (`src/controllers/withdrawalController.js:12-51`). Les contraintes d'unicité sont déclarées dans `scripts/migrate-withdrawal-beneficiaries.js:20-21` et `src/models/KpayOperation.js:7-25`. Le schéma réellement déployé reste à vérifier.
- **Bénéficiaire V2.** Code email expirant, tentatives bornées, coordonnées libres refusées, bénéficiaire rattaché au compte et instantané comparé avant envoi (`src/controllers/beneficiaryController.js:19-27,53-77`, `src/controllers/withdrawalController.js:15,22-36,47-51`, `src/services/kpayOperations.js:22-46,221-235`).
- **Webhooks et audit.** Corps brut, signature HMAC et comparaison à temps constant. Les transitions sont verrouillées, le net attendu est contrôlé avant de marquer le retrait payé et les notifications sont suivies par empreinte (`src/app.js:33`, `src/controllers/kpayWebhookController.js:4-22`, `src/services/kpayOperations.js:59-97,155-211`, `src/services/transactionAudit.js:84-87`).

## 4. Modifications effectuées

Aucune modification applicative. Ce rapport constitue l'unique ajout.

## 5. Tests exécutés et résultats

Non exécutés. Analyse statique ciblée du dépôt. Aucune opération financière, migration ou écriture en base.

## 6. Risques, limites et points restant à traiter

Schéma, index et déclencheurs en production non vérifiés. Stock de retraits historiques, règles opérationnelles de suspension, contrat KPay et éventuelle procédure externe de reprise non vérifiés.

## 7. État final

Terminé. Toute correction est soumise à validation explicite.

## Analyse complémentaire — reprise d’un retrait interrompu

### 1. Objectif

Permettre la reprise d’un retrait réservé dont l’envoi est interrompu, avec au plus un appel d’initiation par opération tant que le résultat du premier peut être positif.

### 2. Analyse et constat initial

- **Avant le commit d’approbation** (`src/controllers/adminController.js:452-473`). Le passage du retrait à `processing` et la création du `PAYOUT` en `CREATED` sont atomiques. Si la transaction échoue, le retrait reste `pending`, avec sa réservation initiale, et l’approbation peut être retentée.
- **Après ce commit, avant le commit de prise en charge** (`src/services/kpayOperations.js:215-244`). Une interruption laisse l’opération en `CREATED` et aucun POST KPay n’a pu partir par ce chemin. Si les contrôles échouent avant la prise en charge, l’état reste également `CREATED`. Aujourd’hui, une nouvelle approbation s’arrête à `processing` (`src/controllers/adminController.js:448`).
- **Dès le commit de `INITIATING`** (`src/services/kpayOperations.js:238-244,257-306`). Une interruption avant le POST et une interruption après acceptation du POST peuvent produire le même état local. Un timeout ou une réponse incohérente peut conduire à `UNKNOWN`. Le délai écoulé et l’absence de `provider_id` ne prouvent pas que le POST n’a pas abouti. Une réponse cohérente peut faire passer l’opération à `PENDING`, en attente de confirmation. Un webhook peut arriver avant l’enregistrement de la réponse.
- **Reprise actuelle.** Le verrou de `dispatch` protège la transition depuis `CREATED`. Le webhook signé peut rapprocher la notification via `external_id` et le traitement terminal est transactionnel (`src/services/kpayOperations.js:59-97,155-211`). La vérification administrative peut consulter une opération avec `provider_id` (`src/services/transactionAudit.js:89-103`). `reconcileDeposit` exclut les retraits (`src/services/kpayOperations.js:321-329`). `scripts/kpay-operations.js:7-15` liste les opérations ouvertes et leur référence externe pour rapprochement, en lecture seule.

### 3. Correction proposée et fichiers concernés

1. **`src/controllers/adminController.js`, `processWithdrawal`.** Réutiliser l’action d’approbation existante comme déclencheur de reprise manuelle persistant après redémarrage. Pour un retrait déjà `processing`, rechercher l’unique opération `PAYOUT` liée et appeler `dispatch` seulement si elle est `CREATED`. Réutiliser l’opération, le payload et la référence externe d’origine. Si l’opération manque, signaler une incohérence. Si elle a déjà été prise en charge, retourner l’état courant et orienter vers le rapprochement. Relire l’état après la tentative.
2. **`src/services/kpayOperations.js`, `dispatch`.** Garder le contrôle autoritatif sous verrou, avec vérification que tout retrait associé est encore `processing` et maintien des contrôles V2. Valider `CREATED → INITIATING` avant le POST. Un seul appelant concurrent franchit cette transition. Ne jamais remettre une opération prise en charge en `CREATED`, même si elle est ancienne. Conserver les états de confirmation déjà obtenus si une réponse tardive arrive. Pour un refus HTTP dont le caractère définitif n’est pas établi par le contrat KPay, garder le retrait réservé et traiter le résultat comme incertain.
3. **Rapprochement avec les mécanismes existants.** Pour `INITIATING`, `UNKNOWN`, `PENDING`, `AWAITING_DETAILS` ou `RECONCILIATION`, aucune réinitiation ni restitution liée au simple délai. Utiliser le webhook signé ou la consultation administrative quand une référence KPay est disponible. Sans cette référence, faire rechercher le transfert par `external_id` côté KPay et maintenir la réservation tant que le résultat reste indéterminé. Un résultat absent de la recherche ne suffit pas à autoriser un nouvel envoi. `src/services/transactionAudit.js` et `scripts/kpay-operations.js` servent de points de rapprochement existants.

### 4. Modifications effectuées

Ajout de cette analyse au rapport. Aucune modification de code.

### 5. Tests ciblés

Non exécutés. À prévoir avec une base isolée pour les verrous et un client KPay simulé.

- Simuler une interruption après l’approbation et avant la prise en charge, puis deux reprises concurrentes. Vérifier une opération, une réservation, une référence externe et un seul POST. Vérifier aussi qu’un retrait hors `processing`, un bénéficiaire V2 incohérent ou un mauvais environnement ne déclenche aucun POST.
- Simuler une interruption après le commit de `INITIATING`, avant le POST puis après acceptation chez KPay avant l’enregistrement de la réponse. Simuler aussi un timeout et une réponse incohérente. Vérifier que les approbations répétées ne lancent aucun nouveau POST et ne restituent rien.
- Livrer une confirmation avant la réponse d’initiation, rejouer le webhook et faire concourir notification et vérification administrative. Vérifier une seule finalisation ou restitution selon le résultat terminal et aucune régression de l’état.

### 6. Risques et limites

La correction proposée réutilise les états persistés et l’action administrative. Elle ne nécessite pas de migration ni de tâche de fond. Une opération qui a franchi `INITIATING` peut rester réservée si KPay ne peut pas établir son résultat. La disponibilité et les garanties d’une recherche KPay par référence externe restent à confirmer avant toute automatisation du rapprochement.

### 7. État final

Analyse terminée. Correction en attente de validation.

## Correction approuvée — reprise des retraits en cours

### 1. Objectif

Reprendre l’envoi d’un retrait déjà `processing` lorsque son opération `PAYOUT` est encore `CREATED`, sans nouvelle réservation.

### 2. Constat initial

L’approbation répétée renvoyait le retrait en cours sans reprendre l’opération persistée. Après le passage à `INITIATING`, l’issue de l’envoi peut être incertaine.

### 3. Fichiers concernés

- `src/controllers/adminController.js`, `processWithdrawal`.
- `src/services/kpayOperations.js`, `dispatch`.

### 4. Modifications effectuées

L’approbation d’un retrait `processing` retrouve son opération `PAYOUT` et reprend uniquement l’état `CREATED`, avec le payload et la référence externe stockés. Le dispatcher conserve la prise en charge sous verrou, exige que le retrait soit encore `processing` et contrôle l’environnement et le bénéficiaire V2 avant le passage durable à `INITIATING`. Les échecs HTTP d’initiation d’un `PAYOUT` restent incertains faute de confirmation terminale. Cette règle s’applique au premier envoi comme à la reprise puisqu’ils partagent le dispatcher. Une réponse tardive ne remplace pas un état terminal enregistré par webhook.

### 5. Tests exécutés et résultats

`node --check` réussi sur les deux fichiers JavaScript. `git diff --check` réussi. Tests fonctionnels et de concurrence non exécutés. Aucun serveur PostgreSQL local isolé détecté et le moteur Docker était inaccessible depuis la session. Aucun appel financier ni accès à une base de production.

### 6. Risques, limites et points restant à traiter

La concurrence et les interruptions restent à vérifier avec une base isolée et KPay simulé. À partir de `INITIATING`, une reprise exige un rapprochement si le résultat demeure incertain. Aucune migration ni mise en production effectuée.

### 7. État final

Implémentation terminée. Validation fonctionnelle bloquée par l’absence d’une base isolée accessible.
