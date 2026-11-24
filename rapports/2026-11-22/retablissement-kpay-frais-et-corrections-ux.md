# KPay, frais de paiement et corrections UX

## Cause et correction financière

L’API locale était configurée en mode KPay production avec live local désactivé. Le frontend refusait donc l’initiation malgré un devis nominal disponible. L’incertitude sur le débit opérateur reste affichée. L’initiation dans un environnement éligible exige le consentement explicite, sans exiger de connaître les frais internes de KPay.

`src/services/votePricing.js` et `src/controllers/paymentController.js` calculent les frais VoteNow à partir de `VOTENOW_KPAY_VOTE_FEE_BPS`, valeur initiale 500 (5 %). Calcul sur le nominal de tous les votes, en FCFA entiers, demi-franc arrondi au supérieur. Le devis fournit `nominal_fcfa`, `votenow_payment_fee_fcfa`, `votenow_payment_fee_bps` et `requested_amount_fcfa`. Le total demandé est revérifié sous verrou avant enregistrement, puis envoyé à l’adaptateur. Le débit final reste inconnu dans le devis. Aucune migration.

Pour 100 FCFA nominaux, KPay reçoit 105 FCFA. La collecte de campagne reste 100 FCFA, la commission standard 15 FCFA et le crédit organisateur 85 FCFA. Les 5 FCFA sont figés dans le snapshot KPay, séparément des frais fournisseur. Les opérations historiques conservent leur montant et leur référence. VoteNow Card conserve son débit de 100 FCFA.

## Frontend

- `VoteClient.jsx`, `VoteQuote.jsx`, `PaymentAttempts.jsx`, `lib/voteAttempt.js`, `lib/api/payments.js` et `lib/i18n/en.json` exposent nominal, frais VoteNow et total demandé. Les tentatives conservent UUID et paramètres. Le test `tests/vote-quote.test.cjs` vérifie la cohérence du nouveau devis.
- `app/events/page.js` réserve 72 px pour la navigation fixe, ce qui place le titre et l’introduction sous le header.
- `CandidateCopyLink.jsx` et `campaign-site.css` utilisent le toast de succès existant pour deux secondes. Le repli manuel est un dialogue accessible avec le lien sélectionné. Aucun changement de disposition à la copie.

## Vérifications et activation

Test Express, PostgreSQL jetable et adaptateur simulé réussi. Exemples 105 et 315 FCFA, arrondis, taux configurable, consentement, rejet d’un devis caduc, deux requêtes concurrentes, un seul envoi à 105 FCFA et un seul vote et crédit malgré deux webhooks. Rejeu réussi après changement du taux, sans nouveau transfert. Schéma supprimé. Tests frontend ciblés, lint et build réussis. Chromium a validé les deux thèmes sur mobile et desktop, la copie sans déplacement, le repli, le consentement KPay avec 105 FCFA et la Card à 100 FCFA.

Aucun flag modifié. Pour une recette sandbox, utiliser des identifiants sandbox, `KPAY_MODE=sandbox` et `KPAY_SANDBOX_VOTES_ENABLED=true` en développement. Le live local ne s’ouvre qu’avec des identifiants live et `KPAY_LOCAL_LIVE_VOTES_ENABLED=true`, après redémarrage de l’API et lors d’un essai réel autorisé. Le taux peut être renseigné explicitement à 500. Préparer un déploiement coordonné API/frontend, car l’ancien formulaire confirme le nominal, tandis que le nouveau valide le montant demandé. La politique du catalogue reste indépendante.

**État final — terminé en simulation.** Le débit effectif du votant et les retenues réelles du fournisseur restent à constater lors d’un paiement autorisé. Aucun paiement réel, push ou déploiement.

## Complément — prix minimum d’un vote

Tout nouveau prix de campagne doit être un entier entre 100 et 10 000 FCFA. La validation commune couvre les mutations organisateur et admin et l’assistant de création. Une campagne à 50 FCFA peut conserver ce prix lors d’une modification de titre ou d’autres champs. La saisie d’un autre prix inférieur à 100 FCFA est refusée, y compris un retour à 50 après adoption d’un nouveau prix. Aucune modification automatique des campagnes ni des données historiques. Le parcours votant utilise déjà la quantité et le prix réel du backend, sans forfait prédéfini à modifier.

Fichiers concernés : `src/services/campaignVotePrice.js`, `campaignSetup.js`, les contrôleurs et routes événement/admin, le formulaire d’édition, `CampaignSetup.jsx` et les traductions. Les tests ciblés confirment le refus de 50 FCFA en création, l’acceptation de 100 FCFA, l’édition d’une campagne historique et ses devis à 50 FCFA nominaux. Les tests d’assistant et le lint ciblé ont réussi. Un avertissement de hook préexistant demeure sur la page d’édition. Aucun test financier réel ni migration.

Après la refonte du vote par montant, le montant initial correspond à un vote. Une campagne historique conserve son prix unitaire dans ses choix rapides, et les choix standard commencent à 100 FCFA pour les nouvelles campagnes. Le test ciblé vérifie aussi qu’un budget de 50 FCFA correspond toujours à un vote sur une campagne historique. Aucune donnée modifiée.
