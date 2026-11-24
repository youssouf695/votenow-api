# Abstraction des paiements et vote par montant

## Contrat public et sélection

`/api/payments/availability` et le devis Mobile Money publient des réseaux métier, un mode de confirmation et des états de disponibilité, sans codes fournisseur, comptes, tarifs techniques ni règles de sélection. Les retours de paiement exposent un indicateur de rapprochement et préservent le lien sécurisé lorsqu’il est nécessaire. Les lectures des recharges et retraits côté utilisateur retirent les références ou snapshots techniques. Les outils admin et les journaux internes conservent ces données. Un lien de paiement externe peut rendre identifiable le prestataire qui héberge sa page.

KPay reste le seul adaptateur réel. Avec le manager actif, les lignes de catalogue activées, le compte, l’environnement, les limites du montant, le tarif publié et la priorité participent à la sélection. Sans manager, le chemin historique utilise la sélection du réseau par numéro. L’initiation revérifie le réseau demandé et l’accès à l’encaissement. Le GET documenté de disponibilité utilise un timeout de 3,5 s et un cache local de 15 s, ou 5 s en cas d’erreur. Le code accepte les deux formes de statut observées, liste et objet. « À vérifier » signifie que le catalogue est éligible sans confirmation de santé. Les retards sont indiqués séparément. Un état disponible n’est pas une garantie de succès pour un numéro précis. Aucun changement de fournisseur après un résultat incertain. [Documentation officielle de disponibilité](https://kpay.site/documentation/utilitaires)

## Montants et interfaces

Le backend calcule `⌊budget / prix unitaire⌋` votes et ne demande que le nominal correspondant, avant les frais Mobile Money VoteNow configurés à 5 % par défaut. Le devis et la création vérifient quantité et montant accepté. Exemple : un budget de 500 FCFA au prix unitaire de 120 donne quatre votes, 480 FCFA nominaux et 504 FCFA demandés, avec 24 FCFA de frais VoteNow. La commission de campagne est calculée sur le nominal. Le plafond Mobile Money inclut les frais, soit 1 000 000 FCFA demandés et 10 000 votes au maximum. Des limites de réseau inférieures peuvent s’appliquer. VoteNow Card conserve ses 100 votes maximum, son solde et son débit exact sans frais Mobile Money.

`VoteClient.jsx`, `VoteQuote.jsx`, `WalletVote.jsx` et leurs clients proposent 100, 500, 1 000, 5 000, 10 000 et 100 000 FCFA, ainsi qu’un budget libre, avec indication du montant convertible. Les réseaux non confirmés sont désactivés. La carte entière de `/events` reste un seul lien avec une élévation discrète compatible avec le mode de mouvement réduit. `PaymentAttempts.jsx`, les traductions, les textes d’aide et l’historique Card utilisent les termes métier.

Côté API, les modifications principales concernent `paymentController.js`, `paymentRoutes.js`, `votePricing.js`, `kpayAmounts.js`, `kpayClient.js`, `paymentProviders/{manager,kpay,mobileHealth}.js`, `wallet.js` et les projections des contrôleurs portefeuille et retraits.

## Vérifications et recette locale

Tests Express sur PostgreSQL distant en schéma jetable avec adaptateur simulé, puis nettoyage. Contrat public, cache et deux formats de santé, éligibilité par réseau et plafond, consentement, montant demandé, UUID concurrent, rejeu et webhook répété vérifiés. Tests ciblés du devis, des tentatives et de la projection de retrait, lint et build réussis. Chromium sur API simulée a vérifié la carte publique, le paiement mobile à 525 FCFA avec réseau indisponible à la sélection, et le débit Card de 100 FCFA en anglais. Aucun paiement réel.

Recette live à lancer uniquement après autorisation d’un essai réel. Sur l’API locale, utiliser les identifiants live privés, `NODE_ENV=development`, `KPAY_MODE=production`, `KPAY_LOCAL_LIVE_VOTES_ENABLED=true` et `KPAY_SANDBOX_VOTES_ENABLED=false`, puis relancer l’API. Conserver le flag manager selon le mode souhaité et l’état de son catalogue. Relancer le frontend sur l’API locale, sélectionner un montant et un réseau confirmé, vérifier le devis et le consentement avant toute initiation. Pour une tentative incertaine, consulter sa référence existante. Les flags n’ont pas été modifiés pendant la réalisation.

**État final — terminé en simulation.** Livraison API/frontend coordonnée requise pour le nouveau contrat public. Aucune migration partagée, paiement réel, push ni déploiement.
