# Mission 27.1 · Vue d’ensemble organisateur

- **Objectif** · Transformer /dashboard en vue de pilotage compacte.
- **Constat** · Le rapport de revenus fournit les agrégats et le classement par campagne. La liste organisateur fournit les couvertures et la progression des brouillons. Les statistiques de retrait détaillent les montants et le nombre de demandes par statut.
- **Fichiers** · votenow/app/dashboard/page.js et votenow/lib/i18n/en.json.
- **Modifications** · En-tête compact, quatre indicateurs, solde avec accès direct au retrait, comparaison collecte/votes, suivi des retraits et brouillons récents, aperçu avec couvertures et synthèse du revenu net et des commissions. La personnalisation reste accessible depuis l’aperçu. Les styles reprennent les tokens clairs et sombres de VoteNow.
- **Tests** · ESLint ciblé, git diff --check, campaign-metrics et build Next.js réussis. Le build signale la dépréciation préexistante de middleware.
- **Limites** · Le rapport organisateur ne fournit pas de série temporelle consolidée ni de compteur global des candidatures à examiner. Le suivi des brouillons se limite aux campagnes récentes. Chromium indisponible pour la vérification visuelle des deux thèmes et formats.
- **État** · Implémentation terminée, validation visuelle restante.

## Correction graphique

Le solde devient le point focal, avec un bouton de retrait et des surfaces adaptées aux deux thèmes. L’anneau compare les cinq premières campagnes selon la collecte ou les votes, avec montants et légende. Les actions de suivi sont compactes. Les campagnes gagnent des couvertures plus visibles, un visuel de secours en cas d’erreur, un badge et un bouton de gestion. La synthèse distingue les statuts de retrait.

ESLint ciblé et git diff --check réussis sur app/dashboard/page.js. Recette visuelle laissée au propriétaire.
