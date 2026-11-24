# Sécurisation des bénéficiaires historiques

## Objectif et constat

Le chemin historique pouvait lancer un transfert avec les coordonnées du retrait sans consulter un bénéficiaire vérifié. Le chemin V2 vérifiait déjà le bénéficiaire lié et son instantané.

## Fichiers et modifications

- `src/services/kpayOperations.js:37,66,252` exige un bénéficiaire actif validé par email, appartenant à l’organisateur et correspondant au téléphone normalisé, à l’opérateur et au nom du retrait. Si le retrait désigne déjà un bénéficiaire, son identifiant doit aussi correspondre. Le contrôle est répété sous verrou à l’envoi et comparé au payload KPay existant. Les coordonnées et la tarification historiques restent figées.
- `src/controllers/withdrawalController.js:145` conserve l’annulation des retraits `pending` et permet à l’organisateur d’annuler un retrait historique `processing` si son opération est encore `CREATED` sans trace d’initiation. Le même verrou départage envoi et annulation. La clôture de l’opération et la restitution du solde sont atomiques.
- `src/controllers/beneficiaryController.js:53` conserve le parcours existant de validation par email. L’organisateur peut valider un bénéficiaire aux mêmes coordonnées puis faire reprendre l’approbation. Les contrôles V2 sont conservés.

## Tests et résultats

Six scénarios réussis sur PostgreSQL distant avec KPay simulé. Le premier passage a bloqué sur le tarif simulé utilisé pour préparer les données historiques. Le harnais a été corrigé puis les scénarios ont été relancés avec succès.

- Bénéficiaire non vérifié, opérateur ou nom différent, bénéficiaire d’un autre compte ou supprimé. Envoi bloqué et solde conservé jusqu’à régularisation.
- Téléphone différent dans le payload. Envoi bloqué, puis restitution unique après deux annulations concurrentes.
- Reprise concurrente avec annulation, dont une annulation pendant `INITIATING`. L’envoi et la restitution s’excluent.
- Annulation possible en `pending`, refusée en `PENDING` et `UNKNOWN`.
- V2. Reprise concurrente avec un seul envoi et confirmation par webhook signé.

Les vérifications de syntaxe, `git diff --check` et `node --test tests/withdrawal-flow.test.cjs` ont réussi. Les schémas jetables et leurs données, dont sept organisateurs et un administrateur lors du dernier passage, ont été supprimés. Les tables existantes ont été préservées.

## Limites et état final

Terminé. Les tests ont utilisé des bénéficiaires de test dont la validation a été préparée directement dans le schéma jetable. Aucun email réel ni transfert réel. Le schéma jetable reproduisait les colonnes et index des tables sources. Un retrait aux coordonnées historiques incomplètes ou différentes doit être annulé puis recréé si l’envoi n’a pas été initié. Une opération d’issue incertaine ou dont la trace est manquante doit être rapprochée avant toute restitution. Aucune migration, aucun push ni déploiement.
