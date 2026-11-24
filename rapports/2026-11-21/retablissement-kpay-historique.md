# Rétablissement du paiement KPay

## Constat et correction

Le parcours précédant la mission 14 validait le montant nominal, normalisait le numéro camerounais, demandait à KPay de sélectionner MTN ou Orange, vérifiait la disponibilité en encaissement puis dispatchait dans l’environnement configuré. Les missions 14/14C ont ajouté deux verrous limités à la sandbox, à l’initiation et au dispatch. Le frontend 15 n’activait que la simulation.

- **API** — `src/controllers/paymentController.js`, `src/services/votePricing.js` et `src/services/kpayOperations.js` rétablissent l’encaissement live avec une configuration live. En local, `NODE_ENV=development` ou `test` et `KPAY_LOCAL_LIVE_VOTES_ENABLED=true` sont requis. En production, le mode live suit la configuration KPay existante. Le sélecteur respecte le catalogue si son flag est actif et réutilise sinon la prédiction KPay et la disponibilité DEPOSIT.
- **Contrat** — Le devis expose `live_allowed`, en conservant `confirmable=false` et les frais et le total à `null`. Une nouvelle initiation live requiert `vote_mode=live`, `accept_unverified_total=true`, le montant nominal dans `expected_amount` et un UUID de tentative. La simulation reste compatible avec les requêtes sandbox de la mission 15. Les références, commissions figées, verrouillage du prix, webhooks et rapprochement restent en place. Une reprise dispatchable reste limitée à une opération CREATED sans indice d’envoi.
- **Frontend** — `app/events/[slug]/vote/VoteClient.jsx`, `lib/voteAttempt.js`, `lib/api/payments.js` et `lib/i18n/en.json` distinguent simulation et live, affichent le nominal et demandent de confirmer que des frais opérateur peuvent s’ajouter. Le numéro national à neuf chiffres est accepté. Le badge local conserve sa logique existante, et l’opérateur transmis à KPay est choisi par le backend. VoteNow Card et les tarifs restent inchangés.

## Vérifications

Quatre scénarios ciblés sur PostgreSQL distant isolé et client KPay simulé ont réussi après correction du second verrou au dispatch. Ils couvrent le nominal et le prix caduc, le consentement et la séparation des modes, Orange et MTN, le succès signé, le refus définitif, le timeout suivi d’une confirmation tardive, le rejeu et la concurrence sans double initiation ni double vote. Les schémas de simulation ont été supprimés.

Build Next.js, test ciblé des devis et Chromium réussis. Sur la session live locale, Chromium a confirmé les deux formats nationaux testés, l’obligation de consentement et sa remise à zéro après changement de numéro. Les requêtes d’initiation étaient bloquées dans le navigateur de test et aucune n’a été émise.

## Session manuelle et limites

Une [campagne locale à 100 FCFA nominaux](http://127.0.0.1:3177/events/test-manuel-kpay/candidates/e366bc4e-78e2-4054-bd94-9f5beaead934?vote=1) est ouverte sur loopback. Le propriétaire saisit son numéro, confirme le montant demandé, clique sur « Payer avec KPay » et valide personnellement côté opérateur. Le coût de l’opération reste inconnu avant cette étape. En cas d’attente, conserver la tentative et vérifier son statut avant de recommencer.

Le schéma manuel est isolé et reste disponible pour l’essai. Le lanceur local, `node /tmp/vn-vote15/manual17.cjs` depuis la racine API, supprime le schéma s’il est vide à l’arrêt et le conserve si un paiement y est enregistré. Un redémarrage crée un nouveau schéma. La session loopback ne reçoit pas les webhooks externes. Elle utilise la consultation de statut KPay, qui dépend de la disponibilité d’une référence fournisseur. Un timeout sans cette référence peut nécessiter un rapprochement manuel.

**État final** — Correction terminée et session prête pour l’essai propriétaire. Aucun paiement réel, push, déploiement ou migration partagée. Une livraison devra coordonner API et frontend, car le frontend de la mission 15 seul ne propose pas la confirmation live.
