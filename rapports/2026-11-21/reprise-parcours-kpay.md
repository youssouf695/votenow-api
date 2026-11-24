# Reprise du parcours KPay en sandbox

## Hypothèse et périmètre

Pour le développement seulement, le scénario Orange Money suppose un brut demandé de 100 FCFA, 2 FCFA de frais KPay déduits côté marchand et 98 FCFA nets. Aucun frais opérateur supplémentaire n’a été démontré. Le débit votant reste inconnu. Aucun paiement réel n’a été exécuté.

## Changements et contrat frontend

- Le contrôleur paiements, `votePricing.js` et le dispatcher KPay rétablissent le parcours de vote uniquement avec `KPAY_SANDBOX_VOTES_ENABLED=true`, `NODE_ENV=development` ou `test` et une configuration KPay sandbox valide. Le contrôle est répété au dispatch. Les clés live et l’environnement applicatif production restent bloqués même avec l’option activée.
- `POST /api/payments/quote` renvoie le nominal, `confirmable: false` et `total_debit_fcfa: null`. En sandbox activé, `simulation_allowed: true` autorise uniquement une confirmation de simulation. `merchant_fee_example` présente l’hypothèse Orange à 100 FCFA, sans l’associer au débit réel. `collection_fee_fcfa` demeure inconnue.
- `POST /api/payments/initiate` exige en sandbox `accept_unverified_total: true` en booléen, le nominal accepté dans `expected_amount` et un `request_id` UUID stable par tentative. Un prix modifié retourne `VOTE_QUOTE_CHANGED`. Si l’option locale est indisponible, le blocage `KPAY_TOTAL_UNVERIFIED` reste applicable.
- L’acceptation sandbox est inscrite dans le snapshot de l’opération. Les opérations `CREATED` historiques dépourvues de cette preuve restent sans envoi. Les opérations déjà initiées gardent leurs références, leur traitement par webhook signé et leur réconciliation, même après désactivation. Aucune modification des commissions ni de VoteNow Card.

## Tests et prérequis

Quatre scénarios réussis sur PostgreSQL distant dans un schéma jetable, avec KPay simulé. Refus par défaut, avec clés live ou sous `NODE_ENV=production`, devis sans total garanti, accord booléen obligatoire, rejet d’un montant modifié, trois initiations concurrentes avec un seul envoi, webhook répété, refus terminal, timeout suivi d’une confirmation tardive et réponse de montant incohérente. Le schéma et ses comptes ont été supprimés. Tests ciblés existants, syntaxe et `git diff --check` réussis.

Utiliser un schéma de données isolé pour la sandbox. Le test n’a utilisé aucune clé live pour initier un paiement.

Avant tout déploiement autorisant de nouveaux votes réels, obtenir de KPay la confirmation du débit total tous frais compris, l’assiette et l’arrondi, la méthode de verrouillage ou de plafonnement de ce total avant initiation et les preuves de règlement marchand. À défaut, toute politique de risque de production exige une approbation explicite et un changement distinct. L’option sandbox ne fournit aucune dérogation de production.

Aucune migration partagée, activation permanente, opération réelle, modification frontend, push ni déploiement.
