# Recette intégrée et préparation de livraison

## Objectif et périmètre

Valider le frontend Next.js de la mission 15 avec l’API Express des missions 14 et 14C. Les deux dépôts existants étaient sur `main`. La recette a utilisé le build frontend existant, Chromium et PostgreSQL distant, avec deux comptes fictifs, une campagne, un candidat et un portefeuille dans un schéma jetable. Seul le client KPay était simulé. Le schéma et ses données ont été supprimés, puis leur absence vérifiée.

## Contrats et résultats

| Parcours | Résultat |
| --- | --- |
| VoteNow Card, `POST /api/wallet/votes/quote` puis `POST /api/wallet/votes` | Le prix est passé de 100 à 102 FCFA entre le devis et la confirmation. Le premier POST a renvoyé 409 `VOTE_QUOTE_CHANGED` avec solde intact. Après nouvelle confirmation, la réponse du POST réussi a été perdue côté navigateur. Le rejeu a conservé le même payload, dont `expected_amount` et `request_id`. Un seul paiement, vote et mouvement Card ont été enregistrés. Le solde est passé de 1 000 à 898 FCFA et l’écran a affiché 102 FCFA. |
| Permissions et KPay hors sandbox | Le devis et le vote Card anonymes ont renvoyé 401. Sans simulation autorisée, le bouton KPay était désactivé et un appel direct à l’initiation a renvoyé 503 `KPAY_TOTAL_UNVERIFIED`. |
| KPay sandbox, `POST /api/payments/quote`, `POST /api/payments/initiate`, `GET /api/payments/status/:paymentId` | Le total restait non vérifié. Le bouton exigeait le consentement et l’API refusait son absence (409). Une initiation simulée de 102 FCFA nominaux a produit un statut en attente. Après désactivation locale de la simulation, deux livraisons concurrentes du webhook signé puis le rejeu ont confirmé le même paiement, avec une seule initiation, un seul vote et une seule commission. Commission et net organisateur totalisaient 102 FCFA, et le solde Card est resté à 898 FCFA. |

Les vérifications ciblées se sont terminées avec succès. Le nettoyage périodique des statistiques a signalé une table absente du schéma minimal, sans effet sur ces parcours. Aucun changement de code métier ni relance des suites précédentes.

## Inventaire et compatibilité

- **Catalogue fournisseurs** — `scripts/migrate-payment-providers.js` et `scripts/payment-providers.sql`. Tables du catalogue et versions tarifaires absentes de `public`. Le DDL ajoute des objets qui référencent le catalogue lui-même. L’administration utilise la table d’audit existante, dont la présence a été vérifiée. Conserver `PAYMENT_PROVIDER_MANAGER_ENABLED` absent ou faux au déploiement initial.
- **Journal financier** — `scripts/migrate-financial-journal.js` et `scripts/financial-journal.sql`. Tables et fonction de début de couverture absentes de `public`. Le script fixe la couverture à sa première application. La version journalisée a besoin des nouvelles tables pour les écritures de retrait. Aucune migration dédiée aux commissions par campagne n’a été identifiée dans le lot 12B.
- **API en production** — Le domaine public a répondu HTTP 200 sur la disponibilité KPay CMR, avec MTN et Orange et `Cache-Control: public, max-age=30`, cohérent avec le parcours historique. L’accès direct Render a subi une réinitialisation de connexion. Le proxy public ne permet pas d’identifier l’artefact déployé, ses flags effectifs ni son comportement d’écriture. La compatibilité de la version déployée avec les migrations reste à vérifier avant feu vert.

## Ordre proposé et retour arrière

1. Identifier l’artefact Express réellement déployé, vérifier sa configuration et ses dépendances SQL, les droits du rôle applicatif, les contraintes et la restauration. Après confirmation et autorisation, appliquer le catalogue seul, vérifier le seed MTN/Orange et conserver le manager désactivé. Contrôler disponibilité, erreurs et latence avant de poursuivre.
2. Programmer une bascule du journal. Suspendre et drainer tous les écrivains de retraits, travailleurs et finalisations KPay inclus. Prévoir la redélivrance des webhooks. Appliquer le journal et démarrer l’API journalisée dans le même créneau, vérifier sa date de couverture et ses droits, puis rouvrir les écritures. Conserver les références et les statuts des opérations en cours.
3. Livrer le frontend après vérification des contrats du backend installé. Contrôler la santé, les permissions, les devis et la consultation de statuts existants sans opération réelle. Surveiller les erreurs webhook, l’ancienneté des statuts en attente et la cohérence des écritures et soldes. L’activation du manager constitue une bascule distincte, après validation des capacités, limites et tarifs.
4. En cas d’incident, revenir au frontend précédent si ses contrats restent compatibles, ou maintenir les initiations en pause. Désactiver la sélection par catalogue si elle est en cause, conserver ses objets et les opérations existantes. Après l’ouverture du journal, conserver les écritures et suspendre les mutations de retrait pendant tout retour à un backend non journalisé. Assurer la reprise des confirmations avant de rouvrir.

## Décisions et état final

**Recette terminée. Livraison bloquée** tant que la compatibilité de l’API déployée n’est pas établie et que la disposition des nouveaux votes KPay live n’est pas décidée. La version candidate bloque ces votes en production, car le débit total votant reste non garanti. `KPAY_SANDBOX_VOTES_ENABLED` doit rester absent ou faux en production et ne permet pas de contourner ce blocage. Le test réel Orange Money de 100 FCFA n’a pas été exécuté.

Avant livraison, choisir entre une suspension explicite des nouvelles initiations KPay live et un lot de livraison qui préserve le parcours actuellement en service. Toute réouverture dans la version candidate exige une garantie fournisseur vérifiable ou une politique de risque expressément approuvée suivie d’un changement séparé. Valider également le créneau de bascule du journal et la redélivrance des webhooks. Aucune migration partagée, modification de flag, livraison, ni opération financière réelle effectuée.
