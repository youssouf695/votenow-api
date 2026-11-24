# Hero éditorial de la page Événements

- **Objectif** · Donner la priorité à la découverte des campagnes sur /events et adapter le hero aux thèmes VoteNow.
- **Constat** · La version précédente reposait principalement sur le dégradé et le titre.
- **Fichiers** · votenow/app/events/page.js et votenow/lib/i18n/en.json.
- **Réalisation** · Composition éditoriale et illustration SVG d’une urne avec des cartes de candidats sur ordinateur. Sur mobile, le titre et l’accès à la recherche passent en premier, avec l’illustration masquée. Surfaces, dégradés, illustration et filtres reprennent les tokens du thème actif. Le nombre de résultats provient du total de l’API lorsqu’il est présent. Les libellés sont disponibles en FR et EN.
- **Vérifications** · ESLint ciblé, git diff --check et tests campaign-pages réussis.
- **Limites** · Chromium et serveur local indisponibles lors du contrôle. Rendu visuel et captures non vérifiés.
- **État** · Implémentation terminée, validation visuelle restante.
