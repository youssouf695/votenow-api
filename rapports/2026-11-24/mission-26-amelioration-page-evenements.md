# Mission 26 · Amélioration de la page Événements

- **Objectif** · Faciliter la découverte et la recherche sur /events.
- **Constat initial** · Le haut de page se résumait à un titre court et deux blocs juxtaposés. Une règle globale dessinait la bordure du champ à l’intérieur d’une seconde bordure.
- **Fichier modifié** · votenow/app/events/page.js.
- **Réalisation** · Hero bleu nuit à accent doré, typographie responsive, lien de création secondaire et panneau de recherche superposé au bas du hero. Champ de 52 px à bordure unique, filtres à état actif visible et focus clavier. Cartes, squelettes, navigation, survol et recherche paginée côté serveur préservés.
- **Vérifications réussies** · ESLint ciblé, git diff --check, build Next.js et six fichiers de tests ciblés couvrant les campagnes, les prix, les devis et les fournisseurs. Le code transmet les paramètres de recherche, de statut et de pagination à l’API. Les modifications existantes dans les deux dépôts ont été conservées.
- **Limites** · Aucun serveur Next.js accessible sur les ports locaux contrôlés et environnement Chromium temporaire absent après l’interruption. Vérification visuelle mobile et desktop, thèmes clair et sombre, et captures avant/après non exécutées. Les tests ciblés ne constituent pas une recette des paiements de bout en bout.
- **État** · Implémentation terminée. Validation visuelle restante.
