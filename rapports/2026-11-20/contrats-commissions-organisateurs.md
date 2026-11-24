# Accords et commissions organisateurs

## Objectif et constat

Les encaissements de votes KPay et les achats VoteNow Card calculent la commission depuis `events.commission_rate`, dont la valeur standard est 15 %. Ce champ est modifiable en administration. Il ne distingue pas un 15 % explicite du défaut. Les plans d’abonnement ont un taux, mais les deux parcours étudiés ne le lisent pas. Les paiements conservent déjà le taux et les montants appliqués, et `commissions` reste le détail financier par paiement.

## Fichiers et modifications

- `scripts/organizer-commissions.sql` et `scripts/migrate-organizer-commissions.js` ajoutent demandes, versions et snapshots. Une seule demande ouverte est admise par périmètre. Les versions publiées sont immuables et une même date d’effet ne peut être publiée deux fois sur un périmètre. Chaque intervalle court jusqu’à la version suivante. Aucun changement sur les données financières historiques.
- `src/services/organizerCommissions.js`, `src/routes/organizerCommissionRoutes.js`, `src/routes/adminRoutes.js` et `src/app.js` gèrent demande, décision motivée, publication, historique et consultation. Le périmètre événementiel est limité au propriétaire de l’événement. Approbation et publication sont atomiques et les décisions concurrentes s’excluent.
- `src/controllers/paymentController.js` et `src/services/wallet.js` peuvent enregistrer le taux réellement appliqué dans la transaction de création du paiement, sous `ORGANIZER_COMMISSION_SNAPSHOTS_ENABLED=true`. Par défaut le flag est désactivé. Le snapshot actif à ce stade conserve la source événementielle existante. Le schéma prévoit la référence de version d’accord pour la prochaine étape.

## API

| Périmètre | Méthodes et chemins |
| --- | --- |
| Organisateur, `/api/organizer/commissions` | `GET /requests`, `POST /requests`, `GET /terms?event_id=…` |
| Administrateur, `/api/admin/finance/organizer-commissions` | `GET /requests`, `GET /organizers/:id/terms`, `POST /requests/:id/approve`, `POST /requests/:id/reject` |

La demande comporte le taux souhaité, le motif et un événement facultatif. L’administrateur renseigne le motif et, pour une approbation, le taux retenu et éventuellement une date d’effet ISO avec fuseau. Les conditions retournent le taux actuel, les versions publiées et un indicateur explicite d’application des accords.

## Tests et résultats

Migration additive rejouée dans les schémas jetables de PostgreSQL distant. Sept scénarios réussis, dont taux standard et dérogatoire, autorisations et propriété, demandes et décisions concurrentes, refus, versions et conflits de date, préservation des paiements historiques, et snapshot atomique avec rollback et contrôle d’immutabilité. Tests ciblés de portefeuille et de rapprochement existants, syntaxe et `git diff --check` réussis. Schémas et comptes de test supprimés.

## Limite et état final

**Application financière des accords en attente de validation.** Un accord général peut entrer en conflit avec un taux événementiel déjà saisi. Proposition à valider, dans l’ordre : accord événementiel publié, dérogation événementielle existante hors 15 %, accord général organisateur, standard de 15 %. Pour les événements à 15 %, l’historique ne permet pas de distinguer une dérogation explicite. Une exception souhaitée à 15 % pourra être publiée en accord événementiel. Aucun taux d’abonnement ne se substitue automatiquement au taux événementiel.

Le calcul de commission reste inchangé et aucun accord publié par les nouvelles routes ne l’influence à ce stade. Après validation de la priorité, le résolveur et l’identifiant d’accord appliqué seront à brancher sur les deux chemins de paiement. Aucune migration partagée, paiement réel, push, déploiement ou modification frontend.
