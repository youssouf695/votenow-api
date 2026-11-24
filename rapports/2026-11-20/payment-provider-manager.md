# Payment Provider Manager

## Objectif et changements

Le backend sélectionnait KPay directement. Le gestionnaire ajoute un catalogue de fournisseurs, comptes, capacités et tarifs. Il sélectionne les capacités actives dans l’environnement courant, avec limites et priorité déterministe. Les devis gèlent l’adaptateur, le compte, la capacité, le tarif et ses termes dans les snapshots existants. L’intégration KPay conserve les endpoints et secrets côté déploiement.

- `scripts/payment-providers.sql` et `scripts/migrate-payment-providers.js` créent quatre tables et initialisent KPay en sandbox et production, sur MTN et Orange en encaissement et retrait. Le seed conserve les réglages administratifs lors d’un rejeu. Les tarifs initiaux suivent le catalogue public de l’adaptateur et l’arrondi existant pour les retraits.
- `src/services/paymentProviders/` contient le registre, l’adaptateur KPay, la sélection, le calcul exact en FCFA et la publication horodatée des tarifs immuables. Les mises à jour sont auditées. Une version prend effet à son horodatage et reste applicable jusqu’à la suivante.
- `src/controllers/paymentController.js`, `src/services/wallet.js`, `src/services/recipientPayout.js` et `src/controllers/adminController.js` intègrent les devis, limites et snapshots. Les encaissements KPay continuent à facturer les frais au checkout fournisseur. Leur simulation locale est indicative et ne majore pas une seconde fois le montant envoyé. Les retraits historiques conservent leurs calculs et les nouvelles opérations gèlent les conditions validées. Aucune provision de frais futurs.
- `src/services/kpayOperations.js` recontrôle l’activation avant la prise en charge et l’appel sortant. Une désactivation se sérialise avec le début de l’envoi. Une opération bloquée avant envoi reste reprenable sur le même compte après réactivation. Les webhooks et consultations d’opérations existantes restent disponibles, y compris dans `src/services/transactionAudit.js`.

## API d’administration

Routes protégées par l’authentification et le rôle administrateur dans `src/routes/adminRoutes.js`, sous `/api/admin/finance/payment-providers`. Les mutations exigent un motif.

| Méthode et chemin relatif | Action |
| --- | --- |
| `GET /` | Catalogue, comptes, capacités et versions de tarifs |
| `PATCH /providers/:code` | Activer ou désactiver le fournisseur |
| `PATCH /accounts/:id` | Activer ou désactiver le compte marchand |
| `PATCH /capabilities/:id` | Modifier activation, priorité et limites |
| `POST /capabilities/:id/tariffs` | Publier taux, fixe, minimum, plafond, arrondi et date d’effet future |
| `POST /simulate` | Simuler un devis selon environnement, sens, montant, réseau et date tarifaire facultative `as_of` |

La simulation évalue le catalogue et les tarifs sans tester la disponibilité réseau du client. Le taux utilise 100 000 000 unités pour 100 %.

## Tests et résultats

Six scénarios réussis sur PostgreSQL distant en schémas jetables, avec KPay simulé et un adaptateur fictif. Migration concurrente et seed sans réactivation, publication concurrente et simulation à date fixe, limites et snapshots, désactivation des nouvelles initiations avec confirmation et consultation préservées, parcours historique avec flag désactivé, priorité entre adaptateurs, concurrence du dispatch sans doublon et sérialisation avec la désactivation. Le premier test tarifaire a dépassé son délai de simulation réel. La relance à date fixe a réussi. Les schémas et données fictives ont été supprimés.

Tests ciblés des retraits, de la réconciliation et du portefeuille réussis, ainsi que les vérifications de syntaxe et `git diff --check`.

## Compatibilité et activation

La migration ajoute uniquement des objets du catalogue. Elle ne modifie aucune table utilisée par l’API actuellement déployée. Son application anticipée est possible après autorisation. L’administration des changements utilise ensuite la table d’audit existante. Si la version déployée inclut le socle financier de la mission 08, sa migration et son créneau de bascule restent des prérequis distincts.

`PAYMENT_PROVIDER_MANAGER_ENABLED=true` active la sélection. Tant que le flag est absent ou faux, les nouveaux flux suivent le parcours historique. Une opération déjà liée garde son fournisseur et ses contrôles. Une fois activé, un catalogue sans capacité admissible retourne « Aucun service de paiement disponible » sans fallback KPay. Vérifier les tarifs et les limites publiés pour l’environnement de déploiement avant activation.

KPay est le seul adaptateur réel et utilise le compte par défaut de chaque environnement. Avant d’ajouter un fournisseur réel, il faudra brancher son entrée webhook signée et vérifier la portée de ses références fournisseur. Le stockage existant conserve leur unicité globale. Aucun transfert réel, frontend, changement sur les tables partagées, push ou déploiement.

**État final** — Implémentation et validation isolée terminées. Application de la migration et activation en attente d’autorisation.
