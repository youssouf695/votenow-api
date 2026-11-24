# Administration — organisateurs et campagnes

## Objectif et constat

Rendre les listes et fiches administratives utilisables sur ordinateur et mobile. Les écrans précédents plaçaient les mutations dans les listes, la fiche campagne se limitait à la commission et la suppression affichée appelait une méthode absente du client API.

## Fichiers et modifications

- Frontend `app/admin/users/`, `app/admin/events/`, `components/admin/AdminDirectory.jsx`, `components/admin/directory.css` et `lib/api/admin.js` — listes paginées avec recherche et filtres. La vue utilisateurs ouvre sur les organisateurs. Les fiches relient le compte et ses campagnes, distinguent vérification et suspension et affichent les montants existants, la chronologie des restrictions et les actions autorisées avec confirmation.
- Frontend `components/admin/CampaignCommission.jsx` — intégration du taux, du formulaire avec motif et de l’historique existants. Consultation seule pour les campagnes archivées. Aucun changement des règles de commission.
- API `src/controllers/adminController.js` et `src/routes/adminRoutes.js` — lecture `GET /api/admin/events/:eventId` sous autorisation admin et filtres de liste `organizer_id` et `archived`. Le détail utilise une liste explicite de champs. Les autres actions réutilisent leurs endpoints. Le bouton de suppression de campagne sans route admin a été retiré.

Les guides locaux frontend et React ont été appliqués en réutilisant le design du tableau de bord, les composants et la convention FR/EN.

## Tests et limites

Lint ciblé, build Next.js, vérifications de syntaxe et test des commissions réussis. Contrat backend vérifié avec modèles simulés. Chromium à 1440 px et 390 px avec API simulée a couvert la recherche, le filtrage, la pagination, la confirmation de suspension, la navigation croisée, l’annulation clavier, le changement de statut et l’édition de commission avec historique. Captures contrôlées sans débordement horizontal.

Le nouveau détail campagne demande la route correspondante à la livraison. La recette navigateur n’a exercé aucune mutation réelle. Aucun changement de code sur les écrans transactions/retraits, aucune migration partagée, aucun paiement réel, push ni déploiement.

**État final — terminé.**
