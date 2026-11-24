# Vérification de la garantie de débit KPay

## Objectif et vérifications

La demande porte sur un encaissement unique de 100 FCFA via Orange Money Cameroun, à la charge du compte se terminant par 1145, au bénéfice de VoteNow. L’appel envisagé est l’initiation d’un paiement entrant. Les lectures KPay ont confirmé l’application et la société VoteNow en production, la disponibilité de l’encaissement Orange Cameroun et un taux public d’encaissement de 2 %. Aucun identifiant de compte ni secret n’a été conservé dans ce rapport.

| Élément | Résultat |
| --- | --- |
| Montant brut à demander | 100 FCFA |
| Commission KPay | Taux public de 2 %. À titre indicatif, 2 FCFA si le taux est applicable sans autre condition. |
| Frais opérateur | Orange indique 0 FCFA pour le paiement marchand. Le rattachement de cette opération précise à cette catégorie et l’absence d’autres frais restent à confirmer. |
| Débit total du payeur | Non vérifiable avant envoi avec les éléments disponibles. |
| Net marchand | 98 FCFA indicatifs si seuls les 2 FCFA sont déduits du brut selon le mécanisme documenté. Montant réel non observé. |
| Références et statut | Aucune opération créée. Aucun débit, crédit marchand ou statut fournisseur observé. |

La documentation KPay distingue le brut demandé, les frais et le net réglé au marchand. Elle ne fournit pas, pour l’USSD Orange de cette intégration, de devis préalable opposable ni de plafond garantissant le montant effectivement débité, tous frais compris. La grille Orange est un indice favorable. Un essai unique pourrait mesurer un débit et un règlement, mais ne suffirait pas à garantir tous les encaissements. [Paiements KPay](https://kpay.site/documentation/paiements) · [Utilitaires KPay](https://kpay.site/documentation/utilitaires) · [Tarification Orange Money Cameroun](https://orangemoney.orange.cm/orange-money/fr/tarification-orange-money.html)

## Options et état final

En attente d’un total exact à confirmer avant le test. Les options sont d’obtenir un devis ou plafond opposable pour ce parcours auprès de KPay, ou de vérifier en environnement de test un parcours fournisseur qui affiche et verrouille le total avant débit. Aucune option activée. Si une initiation est ensuite autorisée, utiliser une référence unique pour toute lecture de statut et exclure tout renvoi automatique. Relever le débit réel à partir du relevé du payeur, séparément du net marchand KPay.

Le code et le blocage existants sont conservés. Seul ce rapport a été ajouté. Aucun paiement, modification frontend, migration, push ni déploiement.
