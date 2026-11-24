# Fiabilisation du paiement votant

## Sources des montants

| Montant | Source et règle |
| --- | --- |
| Prix nominal | `events.vote_price_fcfa × votes_count`. Le devis vérifie que la campagne et le candidat sont disponibles. |
| Frais d’encaissement Card | 0 FCFA pour l’achat de votes depuis le solde Card. La recharge de ce solde est une opération distincte. |
| Débit Card | Nominal accepté par le votant. La ligne du portefeuille est inscrite dans la même transaction que le paiement. |
| Frais et débit votant KPay | Non vérifiés. L’API documente le montant brut demandé, les frais KPay et le net versé au marchand. Elle ne documente pas de devis verrouillé ou de plafond exécutoire couvrant le débit du votant et les frais opérateur. Un taux de catalogue ou une preuve de net marchand ne suffit pas. [Documentation officielle KPay sur les paiements](https://kpay.site/documentation/paiements) |
| Commission VoteNow | Prix nominal × taux courant de la campagne, 15 % par défaut. Calcul en centièmes de point et arrondi à l’entier FCFA le plus proche, au supérieur à la moitié. |
| Part organisateur | Nominal moins commission VoteNow. Les taux et montants appliqués restent dans `payments` et `commissions`. Le devis public ne divulgue pas le taux administratif. |

## Changements et contrats frontend

- `src/services/votePricing.js`, `src/services/wallet.js`, le contrôleur et les routes Card partagent la validation de campagne et de montant. En initiation, les verrous du compte et de la campagne protègent la comparaison avec le montant accepté et l’écriture atomique. Le rejeu retrouve le paiement initial.
- `src/controllers/paymentController.js`, `src/routes/paymentRoutes.js` et `src/services/kpayOperations.js` exposent le nominal KPay, sans initier un nouvel encaissement de vote tant que le total est invérifiable. La garde de dispatch laisse aussi les tentatives `CREATED` historiques sans envoi. Les opérations potentiellement initiées gardent les routes de statut, la réconciliation et les webhooks signés existants.
- `src/services/kpayAmounts.js` remplace l’arrondi flottant de la commission par un calcul entier. Aucun changement de politique de retrait, de provision future ou de recharge Card.

| Méthode | Requête et comportement |
| --- | --- |
| `POST /api/wallet/votes/quote` | Authentifié. Corps `event_id`, `candidate_id`, `votes_count`. Réponse `method`, `currency`, `unit_price_fcfa`, `votes_count`, `nominal_fcfa`, `collection_fee_fcfa`, `total_debit_fcfa`, `confirmable`. |
| `POST /api/wallet/votes` | Même sélection, `expected_amount` égal au total accepté, et `request_id` UUID stable pour une même tentative. Le succès retourne aussi `total_debit_fcfa`. HTTP 409 avec `VOTE_QUOTE_CHANGED` en cas d’écart. L’interface doit obtenir un nouveau devis et une nouvelle confirmation. Après un résultat incertain, conserver l’UUID et les données de la tentative initiale pour son rejeu. |
| `POST /api/payments/quote` | Même sélection et mêmes champs de récapitulatif. `confirmable: false`, frais et débit `null`, code `KPAY_TOTAL_UNVERIFIED`. Le nominal ne doit jamais servir de total. |
| `POST /api/payments/initiate` | HTTP 503 avec `KPAY_TOTAL_UNVERIFIED` pour tout nouvel envoi de vote. Une tentative déjà initiée reste consultable avec sa référence et son corps d’origine. |

## Tests et limites

Cinq scénarios réussis sur PostgreSQL distant en schémas jetables, avec KPay simulé. Devis sans écriture financière, vote Card à 50 FCFA et arrondi, prix modifié et nouvel accord, solde insuffisant, rejeu concurrent avec un seul débit, tarif public KPay variable sans total supposé, tentative historique jamais envoyée bloquée, rapprochement en échec et confirmation tardive rejouée. Le premier harnais attendait HTTP 400 au lieu du 422 existant pour le solde insuffisant. La relance ciblée a réussi. Les schémas et comptes fictifs ont été supprimés. Les quatre fichiers de tests ciblés, la syntaxe et `git diff --check` ont réussi.

**État final.** Garantie du débit Card validée. Nouveaux encaissements KPay bloqués tant que la garantie fournisseur manque.

La mise en production de cette version suspendrait les nouveaux votes KPay. Pour réouvrir ce parcours avec une garantie exacte, obtenir de KPay un total votant confirmé avant initiation et un mécanisme qui préserve ce total jusqu’au débit, frais opérateur compris. Le frontend devra utiliser les devis et respecter `confirmable`. Aucun nouveau montant KPay n’est présenté comme une certitude.

Aucune écriture sur le schéma partagé, migration, opération réelle, modification frontend, push ou déploiement.
