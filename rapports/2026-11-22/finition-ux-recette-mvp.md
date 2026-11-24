# Finition UX et recette locale du MVP

## Changements

- **Navigation admin et organisateur** — `components/dashboard/DashboardShell.jsx` et `app/dashboard/dashboard-theme.css`. Liens regroupés par usage, suppression du doublon Paramètres, navigation nommée selon le rôle et lien actif annoncé. Le tiroir mobile isole l’arrière-plan, se ferme avec Échap et restitue le focus.
- **Finances et accès Card** — `components/dashboard/RevenueReport.jsx` et `components/wallet/WalletVote.jsx`. État vide sans tableau ni pagination superflus. Action de connexion ou d’activation Card visible dans le formulaire de vote.
- **Campagnes et vote public** — `app/events/page.js`, `app/events/[slug]/vote/VoteClient.jsx`, `components/campaign/CampaignImage.jsx`, `CampaignSite.jsx`, `CampaignCandidate.jsx`, `next.config.mjs` et `lib/i18n/en.json`. Optimisation des images Cloudinary et conservation du chargement direct des autres médias. Les effets de vote se rattachent à l’identité de la campagne et de la tentative. Les notifications et les mises à jour de l’affichage utilisent les callbacks actuels sans relancer le cycle de la tentative. Thèmes campagne, contrats API et règles métier conservés.

Guides locaux frontend et React appliqués aux composants existants. Aucun ajout de dépendance aux dépôts ni changement applicatif backend.

## Démarrage pour la recette

Utiliser deux terminaux et une **base PostgreSQL de recette isolée**, avec les prérequis du dépôt et des comptes de test pour chaque rôle. Renseigner `DB_*`, `JWT_SECRET` de recette et les paramètres privés dans l’environnement API. Le démarrage de l’API initialise les limites de débit et exécute un nettoyage de données temporaires. Il doit donc pointer sur la base de recette.

```bash
# Terminal 1, dans votenow-api
NODE_ENV=development PORT=5000 CLIENT_URL=http://localhost:3000 \
  KPAY_MODE=sandbox KPAY_SANDBOX_VOTES_ENABLED=false \
  KPAY_LOCAL_LIVE_VOTES_ENABLED=false PAYMENT_PROVIDER_MANAGER_ENABLED=false npm start

# Terminal 2, dans votenow
API_ORIGIN=http://127.0.0.1:5000 npm run dev -- --hostname 127.0.0.1 --port 3000
```

Installer les dépendances avec `npm ci` dans chaque dépôt si nécessaire. Ouvrir `http://localhost:3000/events` pour le parcours public. Se connecter sur `/login` pour les espaces privés. L’envoi OTP réel requiert une clé et un expéditeur Brevo valides ainsi qu’une IP de sortie locale autorisée. Voir [le diagnostic OTP](otp-connexion-locale.md).

## Checklist manuelle

- **Admin** — `/admin/users` et `/admin/events` pour les listes, fiches et historiques de commission. `/admin/transactions` et `/admin/withdrawals` pour les filtres, détails et confirmations. Fermer les confirmations sans valider.
- **Organisateur** — `/dashboard/revenue`, `/dashboard/withdrawals` et `/dashboard/events`. Vérifier l’affichage séparé du disponible, des réservations et du revenu, les liens campagne et la commission en lecture seule. S’arrêter avant l’enregistrement d’un retrait.
- **Votant** — Depuis `/events`, rechercher une campagne, ouvrir un profil, régler la quantité, comparer les moyens de paiement et lire les devis lorsque disponibles. S’arrêter avant toute initiation.
- **Commun** — Vérifier les menus sur téléphone et ordinateur, Tab et Échap, la langue FR/EN, ainsi que les états vide et erreur sur la base de recette.

## Vérifications et points restants

Build Next.js, lint des fichiers touchés et tests de pages et présentation réussis. Chromium avec API simulée a contrôlé les trois rôles en desktop et mobile, dont le focus du tiroir, l’état vide des finances et l’accès à la connexion Card. Aucune transaction lancée. Le build signale encore la dépréciation de la convention Next.js `middleware`.

La lecture des métadonnées du schéma partagé confirme la présence des prérequis de démarrage, du portefeuille, des bénéficiaires et de l’OTP. Le **catalogue fournisseurs** et le **journal financier** sont encore absents. La gestion du catalogue et les mutations de retraits journalisées nécessitent leurs migrations sur une base de recette isolée. La sélection par catalogue reste désactivée. Les devis Mobile Money dépendent des capacités et de la configuration de recette. La validation réelle de l’e-mail reste tributaire de Brevo.

**État final — finition terminée, recette propriétaire prête à lancer sur un environnement isolé configuré.** Aucun push, déploiement, migration partagée ni paiement réel.
