# Vérification de l’annulation KPay

## Objectif et constat

Deux tentatives Orange Money de 100 FCFA figurent dans le schéma manuel de la mission 17. Le GET KPay sur chaque identifiant fournisseur a renvoyé `FAILED`. Les références et le montant concordaient. KPay n’a pas fourni de motif exploitable permettant de distinguer l’annulation signalée par le propriétaire d’un autre refus. Le premier paiement était déjà en échec local. Le second était encore en attente.

## Intervention et vérifications

Rapprochement ciblé du second paiement via `reconcileDeposit` dans `src/services/kpayOperations.js`, après nouvelle confirmation KPay du statut `FAILED`. Le paiement est passé à `failed` et son opération à `FAILED`. Les deux tentatives ont zéro vote et zéro commission. Après rapprochement, le solde organisateur, les encaissements cumulés et les compteurs de la campagne et du candidat étaient à zéro. Le schéma isolé n’avait ni table d’écritures Card ni lignes du journal financier.

Le code de `app/events/[slug]/vote/VoteClient.jsx` affiche « Paiement non effectué », le message d’échec générique et « Revenir au formulaire ». Un test ciblé du client frontend `lib/api/payments.js` a confirmé que le statut d’échec libère la tentative et qu’un nouvel essai recevrait un UUID distinct. Aucun POST d’initiation pendant ce test. Affichage vérifié dans le code, sans recette navigateur.

## Limites et état final

Les champs KPay indiquent 2 FCFA de frais et 98 FCFA de net. Associés à un statut d’échec, ils ne prouvent ni débit effectif du votant ni règlement marchand. Aucun changement de code. Schéma et tentatives conservés. Aucun paiement réel supplémentaire, push, déploiement ni migration.

**État final — terminé.** Les deux tentatives sont en échec confirmé, sans vote ni crédit local indu.
