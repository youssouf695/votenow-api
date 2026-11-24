# Recette d’intégration du Payment Provider Manager

## Objectif et plan de retour arrière

Appliquer exclusivement le catalogue associé à la mission 09 après vérification de la compatibilité avec l’API déployée. Le SQL crée quatre tables et une fonction et travaille uniquement sur ces objets. Le `DROP TRIGGER IF EXISTS` vise la table tarifaire du nouveau catalogue. Les clés étrangères restent internes au catalogue. Le seed utilise des inserts avec gestion de conflit et conserve les réglages existants au rejeu. La transaction et le verrou consultatif sérialisent l’application. La recette impose également un délai d’attente des verrous.

Avant commit, une erreur ou un contrôle de seed négatif annule la transaction. Après commit, le retour opérationnel consiste à laisser le catalogue dormant et à conserver le parcours historique. Si une suppression devient nécessaire, elle doit faire l’objet d’une autorisation distincte, après vérification des dépendances et sauvegarde des seuls objets catalogue. La suppression se ferait en ordre tarifs, capacités, comptes, fournisseurs, puis fonction, avec `RESTRICT` dans une transaction. Elle n’a pas à toucher les opérations KPay ni le journal financier.

## Précontrôles et migration

PostgreSQL partagé vérifié en lecture seule. Le rôle a les droits `USAGE` et `CREATE` sur `public`, les tables KPay et d’audit existent et les objets du catalogue sont absents. Aucune dépendance des tables métier existantes n’est créée par cette migration. Le journal financier est absent et sa migration n’a pas été lancée.

L’API Render configurée a coupé les connexions TLS sur la racine et la disponibilité KPay. Le même contrôle via le domaine public VoteNow a expiré sans réponse. La compatibilité SQL est établie au niveau du dépôt et du schéma, mais la référence du parcours KPay déployé et la valeur effective du flag de production restent invérifiables depuis cette session. **Migration du catalogue non appliquée au schéma partagé.** Aucun paramètre de production modifié.

## Recette isolée et résultats

- La migration du catalogue a été appliquée uniquement en schéma jetable sur PostgreSQL distant. L’API Express locale a démarré avec le gestionnaire activé et le frontend local a utilisé les véritables routes HTTP administratives via son proxy Next.js. L’authentification utilisait deux comptes fictifs du schéma isolé.
- Contrôles réussis. KPay seul au catalogue et huit capacités. Simulations encaissement et retrait à partir du catalogue public KPay, accès anonyme 401, accès votant 403, saisie invalide 400 et absence de capacité 503.
- Désactivation, réactivation, modification de priorité et publication tarifaire future réussies dans le schéma isolé. La simulation à la date d’effet a sélectionné le tarif publié. Aucune modification du catalogue partagé.
- Chromium mobile a validé la navigation, l’affichage des tarifs, les deux simulations et l’erreur sans capacité. Gestionnaire désactivé dans le processus local, le parcours historique de disponibilité KPay a répondu HTTP 200 avec l’en-tête de cache attendu. Aucun appel d’initiation. Tests ciblés backend et frontend réussis.
- Le démarrage de recette a exclu les tâches de nettoyage du serveur de production. Un nettoyage d’analytics a signalé une table absente du schéma minimal, sans effet sur les vérifications. Le schéma et ses comptes ont été supprimés. Le schéma incomplet laissé par le redémarrage a aussi été supprimé avec `RESTRICT` après vérification de son périmètre.

## État final

Recette locale terminée. Application sur le schéma partagé bloquée jusqu’au rétablissement d’une vérification de l’API déployée et de son parcours historique. Restent alors à appliquer uniquement la migration catalogue et à vérifier son seed et la disponibilité déployée après commit. Seul ce rapport a été ajouté au dépôt. Aucun paiement, retrait, changement de code, push, déploiement ou activation en production.
