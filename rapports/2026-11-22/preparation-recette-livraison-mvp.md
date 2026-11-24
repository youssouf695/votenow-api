# Préparation de la recette et de la livraison MVP

## État de la version candidate

Les deux dépôts existants sont sur `main`. Le frontend utilise le proxy Next.js `/api/:path*` vers `API_ORIGIN`. La configuration locale du proxy et les chemins appelés ont été contrôlés. Aucun changement de code applicatif.

Le démarrage du véritable `server.js` a réussi avec PostgreSQL distant dans un schéma jetable. Le catalogue puis le journal ont été installés uniquement dans ce schéma. Avec trois comptes fictifs, les lectures de fiche et commission admin, de commission organisateur, du catalogue et du devis Mobile Money ont réussi. Les refus d’accès admin pour l’organisateur, de lecture de commission pour le votant et de devis Card sans session ont été confirmés. Les méthodes de mutation des commissions, fournisseurs, retraits et votes ont été comparées aux clients frontend sans être exécutées. Le schéma et ses données ont été supprimés. Aucune suite financière relancée. Le schéma partagé ne contient toujours ni catalogue ni journal.

## Lancement local reproductible

1. Créer une base PostgreSQL **distincte**, réservée à la recette. Restaurer un export **de schéma seul**, sans lignes métier, à partir d’une référence de schéma approuvée. Avec deux services PostgreSQL configurés hors dépôt, la commande type est `pg_dump --schema-only --no-owner --no-privileges -Fc -f "$VN_SCHEMA_DUMP" 'service=vn_schema_source'`, puis `pg_restore --no-owner --no-privileges --single-transaction -d 'service=vn_recette' "$VN_SCHEMA_DUMP"` sur la base vide. Renseigner `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` et un `JWT_SECRET` propre à la recette. Vérifier `current_database()` et `current_schema()` avant tout script. Le démarrage Express écrit notamment dans le périmètre des limites de débit et du nettoyage temporaire.
2. Dans `votenow-api`, sur cette base isolée, exécuter dans l’ordre `node scripts/migrate-payment-providers.js --apply` puis `node scripts/migrate-financial-journal.js --apply`. Vérifier aussi que le schéma de départ possède les tables de base, notamment candidatures et création de campagne, audit, utilisateur et OTP, portefeuille, retraits et bénéficiaires. Installer les dépendances avec `npm ci` dans chaque dépôt si nécessaire. Version vérifiée de Node.js : 22.
3. Créer l’admin local avec `node scripts/create-admin.js` et fournir `ADMIN_EMAIL` / `ADMIN_PASSWORD` uniquement via l’environnement privé. Créer les comptes organisateur et votant depuis `/register` en choisissant leur type, avec des adresses de test accessibles. Utiliser des profils de navigateur distincts pour garder les trois sessions. Depuis le compte organisateur, créer et publier une campagne de recette avec un candidat pour rendre le parcours public visible.
4. Renseigner `BREVO_API_KEY` et `BREVO_SENDER` pour la recette. Le compte Brevo doit reconnaître l’expéditeur et autoriser l’IP de sortie locale dans **Paramètres → Sécurité → Adresses IP autorisées**. Avec un refus 401 d’IP, poursuivre la recette publique et différer les connexions privées. Voir le [diagnostic OTP](otp-connexion-locale.md).

Démarrer les deux services dans des terminaux séparés.

```bash
# votenow-api
NODE_ENV=development PORT=5000 CLIENT_URL=http://localhost:3000 \
  KPAY_MODE=sandbox KPAY_SANDBOX_VOTES_ENABLED=false \
  KPAY_LOCAL_LIVE_VOTES_ENABLED=false PAYMENT_PROVIDER_MANAGER_ENABLED=false npm start

# votenow
API_ORIGIN=http://127.0.0.1:5000 npm run dev -- --hostname 127.0.0.1 --port 3000
```

Le mode sandbox désactivé pour le vote et le live local désactivé constituent le profil de recette sans transaction. Les écrans fournisseur demandant des capacités externes nécessitent des identifiants sandbox dédiés. Pour les actions financières, consulter les états et s’arrêter avant toute initiation.

## Checklist propriétaire

- `/login` — demander le code et ouvrir chaque espace avec son compte de test.
- `/admin/users`, `/admin/events`, `/admin/transactions`, `/admin/withdrawals` — recherche, fiches, historique, confirmation puis annulation de la boîte de dialogue. Catalogue sur `/admin/payment-providers`.
- `/dashboard/events`, `/dashboard/revenue`, `/dashboard/withdrawals` — campagne, taux en lecture seule, solde disponible et réservations distinctes, historique et devis lorsque disponible.
- `/events` — recherche, candidat, partage et copie, quantité et devis. Vérifier sur mobile et desktop, FR/EN et thème sombre. Aucun paiement ni retrait réel.

## Livraison et retour arrière

1. **Validation préalable** — identifier les versions réellement déployées et leurs flags, vérifier droits SQL et sauvegarde, et comparer les migrations avec ces versions. La recette isolée ne démontre pas la compatibilité avec l’artefact en production. Le précédent contrôle public était cohérent avec le parcours historique sans identifier la révision.
2. **Catalogue avant journal** — le catalogue ajoute ses propres tables et un seed idempotent. Après vérifications et autorisation, l’appliquer seul et contrôler les capacités MTN/Orange et les droits. Garder `PAYMENT_PROVIDER_MANAGER_ENABLED=false`. Pour le journal, arrêter et drainer les anciens écrivains de retraits et finalisations, prévoir la redélivrance des webhooks, fixer la couverture par la migration puis démarrer la version journalisée dans le même créneau.
3. **API puis frontend** — publier le frontend après validation des contrats et autorisations de l’API candidate en place. Mettre `API_ORIGIN` au build du frontend. Garder `KPAY_LOCAL_LIVE_VOTES_ENABLED` et `KPAY_SANDBOX_VOTES_ENABLED` désactivés en production. Le live rétabli par la mission 17 requiert un consentement et un mode explicites du frontend coordonné. Vérifier devis, permissions, statuts en attente et traitements existants sans paiement réel. Surveiller erreurs de webhooks, écarts et états bloqués.
4. **Retour arrière** — remettre le frontend précédent seulement si son contrat reste compatible, ou mettre les initiations concernées en pause. Conserver objets du catalogue, références et confirmations. Une fois la couverture financière ouverte, conserver les écritures et suspendre les mutations de retrait pendant tout retour à une API non journalisée.

**Décisions propriétaire** — autorisation de chaque migration partagée et du créneau avec redélivrance des webhooks, choix du moment de publication coordonnée API/frontend, puis décision séparée d’activation du manager. L’autorisation Brevo reste du ressort de l’administrateur du compte.

**État final — préparation terminée.** Aucun push, déploiement, paiement réel ni migration sur le schéma partagé.
