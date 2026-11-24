# Architecture financière et Payment Provider Manager

## 1. Situation vérifiée

Le code et PostgreSQL distant de test concordent sur les structures principales. La base contient `payments`, `withdrawals`, `commissions`, `kpay_operations`, les tables d’audit, les abonnements et le journal VoteNow Card. Aucun catalogue de fournisseurs ou de tarifs versionnés, journal financier commun ou contrat organisateur dédié n’a été relevé. Les opérations KPay portent déjà un environnement. La base de test contient des opérations marquées `production` et `sandbox`. Ces libellés ne prouvent pas le règlement des fonds. Plusieurs index uniques redondants sont visibles sur les références historiques. Leur nettoyage est indépendant de cette architecture.

- **Vote.** `paymentController.js:137-145,190-219` fixe l’assiette à `prix × quantité`, enregistre la commission et le net organisateur, puis transmet cette assiette à KPay. Le code de VoteNow Card décrit la perception des frais client au checkout KPay (`wallet.js:18-20`). La couverture du montant attendu par le règlement réel doit être vérifiée par mode et fournisseur. Une confirmation d’encaissement ne prouve pas seule que ce montant a été reversé.
- **Retrait.** `recipientPayout.js` calcule le net à partir du montant réservé et du tarif KPay pour V2. Le parcours historique vise un net et calcule un brut supérieur (`kpayOperations.js:58-76`). Ces politiques doivent rester identifiables sur les opérations en cours. Les confirmations KPay et les états locaux restent deux preuves distinctes.
- **Soldes et commission.** `users.balance_fcfa` porte le disponible organisateur. `wallet_entries` pilote `wallet_accounts.balance_fcfa`. Un vote Card débite le portefeuille et crédite l’organisateur, avec une commission enregistrée dans la même transaction (`wallet.js:49-58`). `commissions` est déjà unique par paiement sur la base de test. Le taux événementiel est initialisé à 15 % et les paiements conservent le taux appliqué. Les plans d’abonnement ont aussi un taux, mais les deux parcours de vote lus calculent à partir de l’événement. `balanceAudit.js` fournit déjà une base de rapprochement en lecture seule.

## 2. Payment Provider Manager

**Adaptateurs backend.** Un registre de code associe chaque fournisseur à un adaptateur versionné. Contrat normalisé pour l’éligibilité technique, l’initiation, la vérification de signature, la consultation et, si disponible, l’import des règlements. URL, clés et secrets de webhook sont configurés côté déploiement, par compte marchand et environnement. L’administration sélectionne des capacités exposées par le code et publie des paramètres métier bornés.

**Sélection.** Filtrer par environnement, sens, rail, devise, pays, montant, capacités, limites et activation. Appliquer la règle publiée de priorité, avec départage stable. Une indisponibilité confirmée avant toute tentative permet une nouvelle sélection et, si le prix change, un nouveau devis accepté. Après initiation possible, le fournisseur, le compte marchand et la référence sont figés. La désactivation bloque les nouvelles sélections en laissant fonctionner les webhooks et consultations des opérations existantes. Le passage à un autre fournisseur après un échec définitivement confirmé requiert un nouvel ordre explicite et traçable.

| Relation | Contenu et garde-fous |
| --- | --- |
| `payment_providers`, `provider_accounts` | Code adaptateur, libellé, comptes marchands et environnement. Identité technique provisionnée au déploiement, état métier pilotable. Aucune URL ou valeur de secret en base. |
| `provider_capabilities` | Compte, sens encaissement/retrait, pays, devise, rail, activation, minimum et plafond par opération, capacités de vérification. Les plafonds cumulés éventuels nécessitent des compteurs transactionnels et un fuseau explicite. |
| `provider_tariff_versions` | Capacité, version, intervalle d’effet, devise, assiette, mode de prélèvement, fixe, taux entier en unités fines, minimum/plafond de frais, arrondi et ordre d’application. Versions publiées immuables et fenêtres non chevauchantes par capacité. |
| `provider_routing_rule_versions` | Périmètre typé par sens, pays, devise et rail, compte admissible, priorité, dates d’effet et état de publication. Refuser les ensembles ambigus et journaliser auteur, motif et changements. |
| `kpay_operations` vers `provider_operations` | Généraliser la structure existante par étapes, avec compatibilité KPay pendant la migration. Conserver domaine, clé de requête, état et référence externe. Scoper la référence fournisseur par compte marchand et conserver une référence externe locale unique. Étendre l’audit et les reçus au compte marchand et à l’environnement. |

## 3. Tarifs, commission et financement des retraits

Les tarifs d’encaissement et de retrait évoluent indépendamment. Le calcul versionné fixe l’assiette et l’ordre fixe + pourcentage, bornes et arrondi. Il distingue frais ajoutés au checkout, déduits du règlement ou débités séparément. Les montants sont des entiers FCFA et les calculs utilisent une arithmétique exacte. Le devis accepté fige les versions, le fournisseur, les bases, frais estimés, montants et échéance. Le snapshot est conservé sur l’opération et les objets métier existants. Les frais observés et le règlement réel sont enregistrés séparément. Un écart inattendu passe en rapprochement.

Pour un vote, `B = prix × quantité`, `C = arrondi(B × taux VoteNow)`, `O = B − C`. Le taux par défaut reste 15 %. Le frais d’encaissement et la contribution éventuelle aux futurs frais de retrait sont deux lignes distinctes, hors assiette de commission. En politique financée par le votant, le règlement disponible doit couvrir `B + R`, où `R` est la contribution dédiée. Si le fournisseur facture ses frais en plus, lui soumettre `B + R` et afficher son supplément une fois. S’il les déduit, calculer le brut à payer pour encaisser `B + R` net, avec ses bornes et son arrondi. Toute charge fournisseur débitée séparément entre aussi dans le calcul de couverture.

**Recommandation pour les retraits futurs.** Introduire la prise en charge par le votant par campagne ou cohorte couverte, après validation de son calcul et de sa liquidité. Créditer `O` à l’organisateur et affecter `R` à une provision de frais, séparée du disponible et de la commission. Un retrait couvert réserve le principal dans le disponible et le coût dans la provision. Le bénéficiaire reçoit le principal affiché et la provision paie le coût externe une seule fois. À l’échec confirmé, libérer les deux réservations. Au succès, imputer le coût observé et relâcher l’excédent de réservation dans la provision. Le reliquat de provision reste affecté jusqu’à décision métier sur son sort.

**Condition de couverture.** Pour le principal encore dû `L`, estimer `U(L)`, majorant de la somme des coûts de toutes les partitions de retrait autorisées et de tous les tarifs/rails admissibles dans l’horizon garanti. Les frais fixes, minimums et arrondis répétés imposent une taille minimale ou une limite de fractionnement, en comptant un éventuel dernier retrait sous le seuil. Lever assez de contributions pour que la provision disponible couvre ce majorant et que les fonds de règlement correspondants soient disponibles. Avant chaque retrait, vérifier à nouveau que le coût maximal du retrait et `U(solde restant)` sont couverts, en tenant compte des frais déjà réservés. Si aucun plafond futur crédible n’est disponible, lancer la politique couverte seulement avec une garantie ou un apport explicite de VoteNow. En cas de dépassement, bloquer le nouvel envoi ou financer l’écart par un apport tracé. Aucun prélèvement supplémentaire silencieux sur le votant ou l’organisateur.

Les soldes historiques et les parts provenant d’un vote Card restent identifiables séparément. Un vote Card ne porte une contribution dédiée qu’avec un devis explicite avant débit Card et une provenance des fonds rapprochée. Une campagne peut donc avoir des montants couverts et non couverts. Le retrait doit choisir une cohorte explicite ou afficher les tranches et leurs frais avant accord. Une part couverte ne subit pas la déduction actuelle `recipient_pays_v2`. Les obligations historiques continuent sous leur politique documentée jusqu’à une reprise financée et approuvée.

## 4. Contrats et journal

**Contrats organisateurs.** Créer `organizer_agreements` pour l’identité du contrat et `organizer_agreement_versions` pour le taux négocié, les éventuelles conditions de frais, le périmètre et les dates d’effet. Conserver seulement une référence interne au contrat approuvé. Exclure les chevauchements par périmètre. Pour les nouveaux devis, priorité proposée au contrat de campagne, puis au contrat organisateur, puis au taux standard. Les dérogations événementielles existantes restent applicables à leur périmètre jusqu’à reprise explicite. Les abonnements existants peuvent constituer une source de politique si cette règle est approuvée, sans appliquer automatiquement un taux de plan en parallèle d’un contrat. Figer la version et le calcul dans le snapshot du paiement. Réutiliser `commissions` comme détail métier de la commission par paiement. Publication opérationnelle du taux uniquement, workflow juridique exclu.

| Option | Effet |
| --- | --- |
| Journal spécialisé `withdrawal_ledger_entries` | Faible coût d’intégration pour réservation, restitution et succès. Un second journal serait nécessaire pour relier encaissements, commission, provision et règlement. |
| Journal financier commun à écritures équilibrées | Même preuve pour ces mouvements et leurs contreparties, avec plus de travail initial pour définir les comptes, soldes et règles de bascule. |

**Recommandation.** Retenir le journal commun et livrer d’abord les retraits. Reprendre les invariants de la mission 06 sans créer un journal spécialisé parallèle. Garder VoteNow Card dans son propre journal et réutiliser la référence du paiement pour le pont comptable, sans refaire le débit Card.

- `financial_accounts` : compte typé (disponible organisateur, réserve de retrait, provision frais disponible et réservée, commission, compensation fournisseur et fonds réglés), devise, environnement, et propriétaire ou compte marchand selon le type. Pour la politique couverte, la cohorte est identifiable.
- `financial_journal_entries` et `financial_journal_lines` : écriture immuable horodatée, référence métier interne, type, clé d’idempotence unique et lignes débit/crédit équilibrées par devise et environnement. Les références internes et clés d’idempotence restent privées. Les API exposent des références opaques. Contrainte de clôture exclusive restitution/apurement par retrait. Compensation explicite par nouvelle écriture pour les corrections autorisées.
- `provider_settlement_lines` : référence et date du fournisseur, compte marchand, brut, frais, net réellement réglé, identifiant stable de ligne et lien de rapprochement. Une opération initiée ou déclarée réussie peut rester en compensation jusqu’à preuve du règlement. Réutiliser les reçus et états d’audit comme preuves, pas comme lignes financières.
- Même transaction pour l’écriture, la mise à jour des agrégats existants et la transition métier. Une incohérence ou un doublon divergent fait échouer l’ensemble. Réservation = transfert du disponible vers la réserve. Succès = apurement de la réserve vers la compensation fournisseur, sans second débit du disponible. Restitution = sens inverse. Un événement incertain ou rejoué ne comptabilise aucun mouvement supplémentaire. Rapprocher les lignes du fournisseur, le journal, les agrégats et les soldes, en distinguant écarts de calendrier, frais et fonds d’origine inconnue.

## 5. API, frontend et mise en œuvre

**Administration.** Ajouter lecture des comptes/capacités, brouillon et publication auditée des capacités, tarifs et règles de routage, simulation de devis, publication des versions contractuelles et consultation des écarts/règlements. Séparer les droits de lecture, édition et publication. Utiliser des versions attendues pour les mises à jour et exiger un motif lors des publications. Réutiliser le rapprochement administratif existant et afficher l’origine de la preuve.

| API proposée | Fonction |
| --- | --- |
| `GET /api/admin/finance/providers` | Comptes marchands, capacités actives et état observé. |
| `/api/admin/finance/{capabilities,tariffs,routing-rules}` | Liste et création de brouillons, modification versionnée, action `publish` séparée. Publier une nouvelle version pour toute désactivation ou correction. |
| `POST /api/admin/finance/quote-simulations` | Tester une sélection et sa décomposition tarifaire sans initier d’opération. |
| `/api/admin/finance/organizer-agreements` | Lecture, préparation et publication des conditions d’un contrat approuvé. |
| `GET /api/admin/finance/reconciliation` | Relevés, écarts, preuves et état du rapprochement. Les actions de vérification restent dans le circuit administratif existant. |

**Frontend.** Le votant voit le prix des votes, les frais de collecte, la contribution éventuelle et le total. L’organisateur voit le brut du vote, la commission, le net, le disponible, le réservé et le net de retrait, avec la couverture de frais applicable. Le frontend affiche le devis fourni par l’API et demande confirmation après expiration ou changement. L’administration affiche les versions futures et actives, les capacités, une simulation et les écarts à rapprocher. Aucune saisie d’endpoint ni de secret.

**Lots proposés.**

1. **Socle financier et retraits.** Migration additive du journal commun, activation groupée des écritures après drainage des anciennes instances, et date de couverture enregistrée. Les retraits existants gardent leur traitement. Une clôture post-bascule peut être tracée depuis une contrepartie explicitement antérieure à la couverture, sans créer de réservation rétroactive. Aucun solde d’ouverture réputé acquis sur la base des seuls statuts. En cas de retour arrière, suspendre les écritures concernées jusqu’au rétablissement du journal.
2. **Manager KPay et tarifs versionnés.** Encapsuler KPay, ajouter les références de comptes marchands et les snapshots sur les nouveaux devis. Vérifier en parallèle les écarts de calcul avant activation. Garder les anciennes opérations sur leur intégration d’origine et conserver l’accès à leurs webhooks. Utiliser un second adaptateur simulé pour valider la sélection avant tout autre fournisseur réel.
3. **Encaissements, contrats et rapprochement.** Activer les écritures vote/commission et les termes négociés sur les nouveaux devis, rapprocher les règlements et les flux Card via les références existantes. Les historiques et snapshots déjà présents restent intacts. Vérifier la correspondance des références et de l’environnement avant toute reprise de données.
4. **Provision couverte.** Activer uniquement sur un périmètre pilote après validation du plafond de coût, de la liquidité, du traitement du reliquat et de la politique historique. Mesurer au préalable l’impact des minimums et du fractionnement sur les devis.

## 6. Décisions à valider

1. Journal financier commun équilibré, livré d’abord sur les retraits, avec VoteNow Card séparé.
2. Provision dédiée financée par le votant sur les flux futurs, avec minimums ou regroupement. Valider le plafond garanti, le financeur d’un écart et le sort du reliquat.
3. Priorité des contrats et traitement des taux de plan et des dérogations événementielles existantes.
4. Priorité déterministe des fournisseurs et politique de bascule avant initiation uniquement en automatique.

**État final.** Conception en attente de validation. Contrôles de schéma, index et agrégats réalisés sur PostgreSQL distant de test en transaction `READ ONLY`. Schéma et soldes de production, ainsi que les conditions de règlement contractuelles, restent à vérifier avant une bascule. Seul ce rapport a été ajouté. Aucune implémentation, migration, écriture en base, opération réelle, push ou déploiement.
