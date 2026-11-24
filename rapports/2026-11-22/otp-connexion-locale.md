# OTP de connexion locale

## Cause et chemin vérifiés

Sur le frontend Next.js en développement, le rewrite actif envoie `/api/auth/request-login-code` vers Express sur `127.0.0.1:5000`. Les deux serveurs locaux répondaient. Express applique les limites de débit et le contrôle de suspension, vérifie le mot de passe, crée le code puis appelle `src/services/email.js`. Les paramètres Brevo requis sont présents et les tables de connexion sont disponibles. Les consultations Brevo `GET /v3/account` et `GET /v3/senders` ont répondu HTTP 401 avec refus explicite de l’IP de sortie locale. Le service d’e-mail masque le détail au navigateur et le contrôleur invalide le code quand l’envoi échoue.

Fichiers examinés : `next.config.mjs`, `src/routes/authRoutes.js`, `src/controllers/authController.js`, `src/middleware/rateLimit.js`, `src/middleware/loginRestriction.js` et `src/services/email.js`. Aucune modification applicative ou de configuration.

## Vérification ciblée

Un scénario avec l’API Express réelle, un compte fictif dans un schéma PostgreSQL jetable et une boîte de réception privée simulée a réussi. La réponse n’exposait pas le code. La durée de 15 minutes a été vérifiée, une demande immédiate a renvoyé 429, un code erroné a été refusé, la session administrateur a été ouverte puis le rejeu du code a été refusé. Le plafond de vérifications reste appliqué par le middleware existant. Le schéma et la boîte de réception ont été supprimés. Aucune écriture dans le schéma partagé ni envoi réel.

## Connexion et état

Dans Brevo, l’administrateur du compte peut autoriser l’IP de sortie de l’API locale via **Paramètres → Sécurité → Adresses IP autorisées**. Ensuite, utiliser le compte habituel sur `http://localhost:3000/login` et récupérer le code par e-mail. [Documentation Brevo sur les IP autorisées](https://help.brevo.com/hc/en-us/articles/5740111683858-Authorize-and-block-IP-addresses-for-API-and-SMTP-security).

Si l’IP ne peut pas être autorisée, le mode de développement proposé est une boîte locale privée, activée explicitement sous `NODE_ENV=development`, avec base et clé de session isolées. Elle utilise la validation OTP habituelle et le code reste accessible uniquement au processus et à l’utilisateur système local. Le test a validé ce mécanisme via un transport simulé, sans l’intégrer au parcours applicatif.

**État final — connexion réelle en attente de l’autorisation Brevo.** Aucun push, déploiement ni changement sur la base de production.
