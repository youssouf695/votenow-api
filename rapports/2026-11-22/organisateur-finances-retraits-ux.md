# Espace organisateur — finances et retraits

## Objectif et constat

Clarifier le solde disponible, les réservations et les revenus des campagnes. Les API existantes fournissent le solde disponible via `/api/auth/me`, les demandes et leurs totaux bruts par statut via `/api/withdrawals/my-withdrawals`, et les revenus des paiements réussis via `/api/stats/revenue`. Ces revenus cumulés ne sont pas un solde disponible.

## Fichiers et modifications

- `components/dashboard/OrganizerFinance.jsx` et `RevenueReport.jsx` — affiche séparément disponible, réservé en attente, réservé en traitement et revenus. Navigation vers les retraits et fiches campagne. Tableau de résultats adapté au mobile, avec taux courant en lecture seule et sans motif interne.
- `app/dashboard/withdrawals/page.js` — historique paginé et filtrable, statuts explicites, bénéficiaire et montant brut, frais et net lorsqu’ils sont enregistrés. Annulation confirmée pour les demandes en attente. Rafraîchissement des données après l’action.
- `app/dashboard/withdrawals/new/page.js` — devis en lecture seule, récapitulatif de la destination, du brut, des frais et du net, puis confirmation explicite. En cas de résultat incertain, le rejeu utilise le même UUID et le même payload après rechargement.

Réutilisation du design système, des conventions FR/EN et des guides locaux frontend et React. Aucune modification API ou des règles de retrait et de commission.

## Tests et limites

Build Next.js, lint ciblé et tests existants des retraits et commissions réussis. Chromium à 1440 px et 390 px avec API simulée a couvert les soldes séparés, l’accès à une campagne, le devis, la confirmation et son annulation clavier, la perte de réponse et le rejeu à l’identique, le filtrage et l’annulation d’un retrait. Captures vérifiées sans débordement horizontal dans les écrans contrôlés.

Les montants réservés affichés correspondent à la somme brute des demandes dans les deux états actifs. Ils proviennent des agrégats existants. Aucun paiement, retrait réel, push, déploiement ni migration partagée.

**État final — terminé.**
