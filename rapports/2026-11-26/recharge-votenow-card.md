# Mission 30.2 — Recharge VoteNow Card

## Diagnostic

La consultation de disponibilité en production renvoyait `OPERATIONAL` pour MTN et `CLOSED` pour Orange. Le devis Orange était donc refusé avant l’initiation. Ce blocage dépend de la disponibilité opérateur. Le chemin historique utilise désormais le même interpréteur de disponibilité que le Payment Provider Manager.

Autre cause reproduite en simulation. Si une confirmation transmet le net sans frais, l’ancien code le combinait avec les frais conservés lors de l’initiation. Une différence entre les deux réponses déclenchait `PROVIDER_SETTLEMENT_INVALID` et bloquait le crédit malgré un montant confirmé cohérent. Le rapprochement utilise maintenant les données de la confirmation seule pour les contrats actuels. Le contrat de net exact des recharges plus anciennes reste applicable.

## Correction et activation

Le [service de recharge](../../src/services/wallet.js) sélectionne la capacité sur le total effectivement demandé avec le manager lorsque le nouveau tarif est activé. Pour 1 000 FCFA, le taux initial de 500 points de base donne 50 FCFA de frais, soit 1 050 FCFA demandés pour 1 000 FCFA crédités. Le contrat, la version et les montants sont figés dans la recharge et dans l’opération prestataire. La [finalisation](../../src/services/kpayOperations.js) réutilise les contrôles de confirmation authentifiée, le verrou, le journal portefeuille et les écritures du grand livre dans la même transaction. Les frais opérateur éventuels restent distincts.

Activer `WALLET_TOPUP_FEES_ENABLED=true` uniquement après bascule validée de 29.4 et validation des capacités de dépôt. Le devis payant est limité à l’environnement production et refuse de s’établir sans tarif actif ni journal et déclencheurs comptables. L’envoi et la finalisation recontrôlent le socle pour les devis payants déjà engagés. Laisser le flag désactivé avant la bascule.

Le [panneau de recharge](../../../votenow/app/dashboard/wallet/page.js) reprend les couleurs et la composition existantes. Frontend-design a guidé le récapitulatif compact, la mise en évidence du crédit et du total, et la confirmation explicite. Les états d’attente relisent la même tentative et le solde est actualisé à la confirmation.

## Vérification

Simulations ciblées réussies pour le devis à 1 050 FCFA, le crédit unique de 1 000 FCFA, l’échec sans crédit, le rejeu, la recharge historique et le refus sans socle comptable. PostgreSQL en schéma isolé annulé a confirmé les écritures du principal et des frais. Syntaxe JSX contrôlée. Aucun paiement réel, aucune migration partagée, aucun push ni déploiement.
