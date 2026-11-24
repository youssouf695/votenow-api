# Finalisation du parcours votant

## Objectif et constat

Réduire le défilement entre la découverte et la confirmation du vote. La recherche filtrait seulement la page de campagnes chargée. Le montant saisi était converti en votes par arrondi inférieur, et le formulaire répétait des informations déjà affichées.

## Fichiers et modifications

- `app/events/page.js`, `components/campaign/CampaignSite.jsx`, `CampaignCandidate.jsx` et `campaign-site.css` — liste compacte, accès direct aux candidats pour les campagnes ouvertes, action de vote nommée pour chaque candidat et formulaire remonté sur mobile. Les thèmes et réglages de campagne sont conservés.
- `app/events/[slug]/vote/VoteClient.jsx`, `components/campaign/VoteQuote.jsx`, `PaymentAttempts.jsx`, `components/wallet/WalletVote.jsx`, `lib/api/payments.js` et `lib/i18n/en.json` — quantité ajustable de 1 à 100, prix unitaire et devis, choix explicite du moyen de paiement, saisie nationale à neuf chiffres et opérateur affiché d’après la réponse serveur. États attente, incertitude, échec et succès distincts. L’historique reste accessible. Les montants non garantis sont indiqués comme non vérifiés.
- `src/services/publicCampaigns.js` — filtre optionnel `search` par titre sur la liste publique existante, combiné au statut et appliqué avant pagination. Les parcours financiers, références et règles serveur restent inchangés.

Réutilisation des guides frontend et React disponibles et du design VoteNow. Aucune dépendance ajoutée aux dépôts.

## Vérifications et limites

Build Next.js réussi et lint ciblé sans erreur. Il reste des avertissements sur les images et les dépendances de hooks. Tests existants des devis, des tentatives et des campagnes, ainsi que le contrôle ciblé du filtre API, réussis. Chromium avec API simulée, en français à 390 px et en anglais à 1440 px, a vérifié la recherche, la quantité, le consentement, le numéro national, la reprise avec UUID identique après réponse perdue, l’attente, la confirmation, l’échec terminal et le débit exact Card. Captures vérifiées sans débordement horizontal.

**État final — terminé.** Aucun paiement réel, push, déploiement ni migration partagée.
