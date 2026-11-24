# Conception du journal comptable des retraits

## 1. Objectif et constat

Tracer les mouvements de retrait sur le solde organisateur `users.balance_fcfa`. Les états, décisions et notifications sont déjà audités, mais ces traces ne contiennent pas d’écriture comptable reliant le montant au mouvement. Le journal `wallet_entries` pilote le solde VoteNow Card `wallet_accounts.balance_fcfa`. Réutiliser son modèle d’immutabilité et le circuit d’audit des retraits, sans faire transiter les fonds organisateurs par ce portefeuille.

| Mouvement | Chemin actuel |
| --- | --- |
| Réservation | `src/controllers/withdrawalController.js:26-52` débite le compte et crée le retrait. |
| Restitution par annulation | `src/controllers/withdrawalController.js:164-171` recrédite le compte, y compris pour un historique admissible encore `CREATED`. |
| Restitution par rejet | `src/controllers/adminController.js:457-470` recrédite le compte lors du rejet d’un retrait `pending`. |
| Restitution après échec KPay confirmé | `src/services/kpayOperations.js:245-263` recrédite le compte et clôture le retrait et l’opération. |
| Apurement après succès KPay | `src/services/kpayOperations.js:221-244` clôture le retrait. Le solde disponible a déjà été débité à la réservation. |

Les verrous et les états existants protègent les transitions. Une écriture ajoutée hors de leur transaction pourrait être orpheline après rollback, manquer après commit ou être répétée par un rejeu. La restitution par plusieurs chemins exige une clé commune et la restitution et le succès doivent s’exclure au niveau de la base.

## 2. Schéma proposé

Créer une table append-only `withdrawal_ledger_entries` avec les champs suivants.

| Champ | Règle |
| --- | --- |
| `id` | UUID interne, clé primaire. |
| `withdrawal_id`, `organizer_id` | UUID obligatoires, clés étrangères vers le retrait et le compte avec suppression restrictive. Le service dérive le propriétaire du retrait verrouillé. |
| `kind`, `direction` | Réservation / débit du disponible, restitution / crédit du disponible, confirmation / apurement de la réserve. Combinaisons contrôlées par contrainte. |
| `amount_fcfa`, `available_delta_fcfa` | Entiers. Montant positif égal au montant réservé du retrait. Delta respectivement négatif, positif ou nul. Le net KPay reste consultable sur l’opération liée. |
| `recorded_at` | Horodatage PostgreSQL avec fuseau. |
| `source_kind`, `kpay_operation_id` | Origine contrôlée (demande, annulation, rejet, échec KPay confirmé, succès KPay confirmé). Référence interne à l’opération lorsque pertinente, obligatoire pour une confirmation fournisseur. Vérifier que l’opération concerne le même retrait. |
| `idempotency_key` | Clé interne stable et unique dérivée du retrait et du mouvement. Tous les chemins de restitution utilisent la même clé. |

Contraintes supplémentaires proposées : unicité de `(withdrawal_id, kind)` et index unique partiel sur `withdrawal_id` pour les deux mouvements terminaux. Un index `(organizer_id, recorded_at)` permet les lectures d’audit. Réutiliser la fonction d’immutabilité `vn_audit_immutable()` pour bloquer les mises à jour et suppressions, puis limiter le rôle applicatif à l’insertion et à la lecture de la table. La première livraison n’ajoute aucune API. Si une lecture est intégrée au journal administratif, utiliser une projection explicite et des références opaques dédiées, sans exposer les clés primaires, étrangères ni d’idempotence.

## 3. Invariants et intégration

- Un service commun reçoit la transaction existante, conserve l’ordre des verrous de chaque chemin et couple l’insertion du mouvement à la transition métier et, si nécessaire, à la mise à jour de `users.balance_fcfa`. La réservation crée le retrait dans cette même transaction avant d’insérer son mouvement. Une confirmation réussie enregistre l’apurement à delta zéro.
- Un conflit d’unicité provoque un rollback complet si une transition ou une mutation a commencé. Une requête déjà appliquée retourne son résultat existant après vérification du type, du montant et du retrait. Toute divergence est signalée. Aucun conflit d’insertion ne doit être ignoré après une mutation de solde.
- Verrouiller et vérifier le solde organisateur avant tout débit. La colonne est nullable sur la base de test. Si sa valeur est absente, interrompre l’opération plutôt que de journaliser un débit fictif. Ne pas corriger les soldes existants dans cette migration.
- Les échecs incertains, contradictions, suspensions et relectures ne produisent aucun mouvement. Un événement terminal répété ne produit aucune seconde écriture. Le rapprochement futur pourra comparer le delta comptabilisé au chemin métier, sans assimiler ce journal de retrait à un historique complet du solde organisateur.

## 4. Déploiement proposé et impacts

1. Après validation, tester en schéma isolé la concurrence, le rollback forcé, le rejeu et l’apurement sans second débit. Vérifier le comportement d’un retrait ouvert avant la date de couverture et clôturé après.
2. Déployer d’abord la migration additive. Elle ne crée aucune écriture rétroactive et ne modifie ni les anciens statuts ni les soldes. Activer ensuite tous les chemins d’écriture sur la même version. Pendant la bascule, drainer les anciennes instances et suspendre brièvement les écritures de retrait, y compris la finalisation KPay. Les webhooks reçus pendant la pause doivent obtenir un statut temporaire permettant le rejeu. Enregistrer le début de couverture. En cas de retour arrière, suspendre les écritures de retrait jusqu’à rétablissement de la version journalisée.
3. Pour un retrait déjà ouvert au début de la couverture, journaliser uniquement sa restitution ou son apurement lorsqu’il se produit. Indiquer dans l’audit que la réservation n’a pas d’écriture dans le journal. Signaler l’absence de réservation sur un retrait créé après la bascule. Aucun mouvement d’ouverture ni solde antérieur ne sera déduit des états d’audit.

## 5. Vérifications, limites et état final

PostgreSQL distant de test vérifié en transaction `READ ONLY`. Tables et déclencheurs d’audit et de portefeuille présents, sans table dédiée aux mouvements de retrait. Aucun retrait `pending` ou `processing` dans cet environnement lors du contrôle. Le volume et le schéma de production restent à vérifier avant une éventuelle bascule. Les autres sources de variation du solde organisateur, dont les encaissements et les ajustements manuels, restent hors du périmètre.

Seul ce rapport a été ajouté. Aucun test d’écriture, changement applicatif, transfert réel, migration, push ou déploiement. **Conception en attente de validation.**
