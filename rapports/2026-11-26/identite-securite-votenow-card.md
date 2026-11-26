# Mission 30.3 — Identité et sécurité de VoteNow Card

Une Card interne par portefeuille. Le serveur génère 15 chiffres aléatoires et un chiffre de contrôle, chiffre le numéro avec AES-256-GCM et stocke une empreinte HMAC unique et le suffixe. La réémission remplace l’identité numérique sur le même portefeuille. Le solde, l’historique et le grand livre restent attachés aux structures financières existantes.

Le PIN personnel est confirmé, filtré contre les suites et répétitions simples, et haché avec Argon2id, sel individuel et pepper. Les codes email à usage unique sont liés au compte, à l’adresse, à la version de session, au jeton de session et à l’action. Ils expirent après 15 minutes. La base centralise les limites de PIN et de code. Les changements de PIN, de numéro et de statut incrémentent la version de sécurité et invalident les défis existants. La mission 30.4 devra lier chaque autorisation de vote à cette version et la vérifier sous verrou.

Le titulaire dispose du [panneau de sécurité](../../../votenow/components/wallet/CardSecurity.jsx) sous la carte existante. Frontend-design a guidé les contrôles compacts, la révélation temporaire, les confirmations et le maintien de la composition actuelle. Le blocage administratif et sa levée sont disponibles via `POST /api/admin/users/:userId/wallet-card`, avec motif et journal immuable. Une levée administrative laisse au titulaire la réactivation. Le blocage suspend les nouvelles recharges, tandis que le rapprochement des tentatives déjà engagées reste possible.

## Bascule avec 30.4

Garder `WALLET_CARD_IDENTITY_ENABLED` désactivé. Configurer quatre clés distinctes de 32 octets encodées en hexadécimal dans le coffre de secrets, `CARD_NUMBER_KEY`, `CARD_LOOKUP_KEY`, `CARD_PIN_PEPPER` et `CARD_OTP_KEY`. Valider le canal email et réserver les changements DDL au rôle de migration. Tester la restauration sécurisée des clés. Leur rotation doit prévoir la migration des numéros chiffrés et des empreintes, la récupération des PIN et l’expiration des défis.

Appliquer la [migration Card](../../scripts/migrate-wallet-card.js) après validation de la bascule. Son déclencheur interdit au journal portefeuille toute dépense historique pour une Card constituée, même via un ancien écrivain. La mission 30.4 devra introduire le règlement autorisé et faire évoluer cette garde avant l’ouverture de l’activation aux titulaires. Le paiement Card public reste hors de cette mission.

## Vérification

`node scripts/check-wallet-card-isolated.js --rollback-only` couvre le schéma, le solde et l’historique, l’activation unique, le format et le chiffrement du numéro, Argon2id, la récupération, les seuils, le cycle de blocage et la garde anti-contournement. Envoi email simulé, aucune preuve de livraison réelle. Tests de recharge existants et syntaxe JSX vérifiés. Aucune migration partagée, aucun paiement, push ou déploiement.
