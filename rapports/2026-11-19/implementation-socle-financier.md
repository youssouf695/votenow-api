# Implémentation du socle financier

## Objectif et constat

Les retraits modifiaient le disponible organisateur sans écriture financière dédiée. Le lot 1 met en œuvre le journal commun proposé dans le rapport d’architecture, avec couverture limitée aux retraits.

## Fichiers et modifications

- `scripts/migrate-financial-journal.js`, `scripts/financial-journal.sql` et `src/models/FinancialJournal.js` ajoutent les comptes, en-têtes et lignes. Une contrainte différée impose les deux lignes équilibrées, leur montant, leurs comptes et la cohérence avec le retrait et l’opération source. Les clés d’idempotence et l’unicité de la clôture empêchent les doublons et l’association restitution/apurement. Des déclencheurs interdisent modification, suppression et troncature.
- `src/services/withdrawalJournal.js`, `src/controllers/withdrawalController.js`, `src/controllers/adminController.js` et `src/services/kpayOperations.js` enregistrent réservation, annulation, rejet, restitution fournisseur et apurement dans leurs transactions existantes. Un succès transfère la réserve vers la compensation fournisseur sans redébiter le disponible. Les frais et la qualification des événements KPay sont conservés.
- `tests/withdrawal-flow.test.cjs` et `tests/campaign-foundations.test.cjs` adaptent les doubles de test. Le journal reste interne et séparé de VoteNow Card.

## Couverture, rapprochement et rollback

La fonction PostgreSQL `vn_financial_coverage_start()` conserve l’instant UTC de première application de la migration dans le schéma visé. Le rejeu préserve cette valeur. La production n’a pas encore de date de couverture. Une clôture sans réservation journalisée n’est admise que pour un retrait créé avant cet instant. Elle utilise une contrepartie `pre_coverage`, sans écriture rétroactive. Une réservation manquante après la bascule provoque un rollback.

Le journal enregistre les mouvements du disponible organisateur existant en XAF, dans le livre `organizer_current`. Il ne requalifie pas la provenance de l’ancien solde. La compensation fournisseur trace l’apurement de la réserve. Le rapprochement de trésorerie et les éventuels frais réels restent à établir à partir des règlements du fournisseur. Aucun solde d’ouverture n’est supposé.

**Décision de bascule.** Choisir un créneau où toutes les anciennes écritures sont drainées, y compris les finalisations KPay, avant d’appliquer la migration et de démarrer la version journalisée. Prévoir la redélivrance des notifications pendant la pause et vérifier les horloges. Le rôle applicatif doit pouvoir lire et insérer sur les nouvelles tables. En cas de retour arrière, conserver le journal et suspendre les écritures de retrait jusqu’au retour d’une version journalisée. Éviter tout redémarrage d’anciens processus capables de modifier les soldes pendant cette pause.

## Résultats des tests

Migration additive et rejeu validés sur PostgreSQL distant en schémas jetables. Sept scénarios réussis avec KPay simulé : réservation concurrente et rejeu, annulation/rejet concurrents, succès signé répété, échec confirmé concurrent, clôture historique, rollback et écriture incomplète, immutabilité et clôture exclusive. L’échec a été simulé à l’entrée du traitement d’un statut déjà vérifié. Le premier passage du scénario de réservation attendait à tort deux réponses HTTP 200. Après correction du harnais, le scénario a confirmé un seul retrait, un seul débit et une seule écriture. Schémas et données de test supprimés.

Tests ciblés sous `tests/`, syntaxe et `git diff --check` réussis. La copie existante de `campaign-foundations.test.cjs` sous `src/tests/` ne se charge pas à cause d’un chemin d’import invalide déjà présent. Le harnais PostgreSQL a contourné localement un fichier UUID manquant dans l’installation de Sequelize sans modifier les dépendances.

## État final

Implémentation terminée et testée en schéma jetable. Aucune migration sur les tables métier existantes, opération réelle, modification rétroactive, push ou déploiement.
