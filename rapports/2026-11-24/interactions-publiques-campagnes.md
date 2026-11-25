# Interactions publiques des campagnes

- **Objectif** · Faciliter la découverte, la copie du lien et le vote direct.
- **Constat** · La copie explicite existait sur la fiche candidat. Les modèles personnalisés avaient déjà un lien de vote configurable. La grille historique utilisait un lien englobant la photo et le texte.
- **Fichiers concernés** · Pages publiques événements, composants CampaignSite, CampaignCandidate et PublicCopyLink, styles de campagne et utilitaires d’URL.
- **Modifications** · Actions des cartes événements mises en valeur avec les destinations existantes. Copie mutualisée avec notification de réussite de deux secondes et dialogue de repli. CTA de vote renforcé dans les modèles personnalisés et ajouté sous les portraits historiques, avec contrôle de l’ouverture et reprise de l’identifiant du candidat. Les variantes minimal, poster et detailed, les masques photo et la configuration de l’organisateur conservent leur structure.
- **Tests** · ESLint ciblé sans erreur avec deux avertissements préexistants sur les images, git diff --check, tests campaign-pages et presentation, et assertion sur la construction de l’URL canonique.
- **Limites** · Clipboard, dialogue de repli et rendu des variantes non vérifiés dans un navigateur. Les pages clientes utilisent NEXT_PUBLIC_SITE_URL ou le domaine public VoteNow par défaut.
- **État** · Implémentation terminée. Recette navigateur restante.
