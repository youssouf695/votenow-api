# Finalisation des commissions par campagne

## Objectif et constat

La commission appartient à la campagne. Les nouvelles campagnes conservent le défaut de 15 %. La mission 12 ajoutait des demandes et accords qui n’avaient pas été activés sur le schéma partagé. L’ancien réglage administratif de la campagne ne produisait pas d’historique. KPay calculait le taux avant une consultation réseau, tandis que VoteNow Card verrouillait déjà la campagne.

## Fichiers et modifications

- Retrait des routes, du service, des scripts de migration de négociation et du flag de snapshot de la mission 12. Aucun accord général ou invitation à négocier. Aucune table modifiée.
- `src/services/campaignCommission.js`, `src/controllers/campaignCommissionController.js`, `src/routes/adminRoutes.js`, `src/routes/eventRoutes.js` et `src/controllers/adminController.js`. Le changement utilise le verrou de campagne et enregistre le motif interne, l’auteur et l’ancien et le nouveau taux dans `transaction_admin_actions`, dans la même transaction. La route d’édition historique passe par le même contrôle quand elle change le taux. Une requête identifiée rejouée ne peut pas restaurer un taux après une nouvelle modification.
- `src/controllers/paymentController.js`, `src/services/kpayOperations.js` et `src/services/wallet.js`. KPay fige le taux sous verrou lors de la création du paiement, après la sélection technique et avant l’appel financier. Sa confirmation réutilise les montants et le taux du paiement. VoteNow Card conserve son verrou et sa transaction. La confirmation KPay verrouille la campagne avant le candidat, comme le vote Card. Les champs financiers existants suffisent, sans snapshot supplémentaire ni recalcul rétroactif.

## API finales et prérequis frontend

| API | Utilisation |
| --- | --- |
| `GET /api/admin/events/:eventId/commission?page=1` | Taux actuel, propriétaire et historique paginé avec auteur, motif et ancien/nouveau taux |
| `PATCH /api/admin/events/:eventId/commission` | Administrateur, avec `commission_rate` de 0 à 50 % et deux décimales au maximum, `reason` de 10 à 1 000 caractères et `request_id` UUID stable pour le rejeu |
| `GET /api/events/:eventId/commission` | Organisateur propriétaire, taux actuel et dernier changement factuel sans motif interne ni identité de l’auteur |
| `PUT /api/admin/events/:eventId` | Édition existante. Un changement de taux exige `commission_reason` ou `reason`. Les autres modifications gardent leur contrat. |

Le frontend pourra afficher le dernier changement avec sa date et réutiliser le même `request_id` pour retenter une modification administrative. L’historique commence au premier changement audité. Aucune notification sortante ni interface ajoutée.

## Tests et état final

Cinq scénarios réussis via les routes Express et PostgreSQL distant en schéma jetable. Défaut 15 %, droits et propriété, changement admin avec historique privé et rejeu concurrent, taux KPay figé malgré deux changements et confirmation rejouée, VoteNow Card concurrent et sans second débit, rollback forcé de l’audit et contrôle de la route historique. Un paiement antérieur a conservé son taux et ses montants. KPay simulé, schéma et comptes fictifs supprimés. Les tests ciblés existants, la syntaxe et `git diff --check` ont réussi. Le schéma minimal a émis un avis de nettoyage analytics sans effet sur la recette.

Terminé. Réutilise les tables et l’index d’audit existants. Aucune nouvelle migration, écriture sur le schéma partagé, opération financière réelle, modification frontend, push ou déploiement.
