# Réservations — notre propre système

Le formulaire du site envoie la réservation à **`/api/reserve`** (fonction
serverless Vercel, dans ce dépôt). Cette fonction valide la demande puis
**envoie un courriel au restaurant via SMTP**, en utilisant la boîte courriel
que le restaurant possède déjà. Aucun service tiers de formulaire.

```
Client → formulaire kawtar.ca → /api/reserve (notre code) → SMTP → boîte du restaurant
```

## Configuration (une seule fois)

Vercel → projet **kawtar** → **Settings → Environment Variables** :

| Variable | Valeur | Exemple |
|---|---|---|
| `SMTP_HOST` | serveur SMTP de la boîte courriel | `smtp.gmail.com` |
| `SMTP_PORT` | `587` (ou `465`) | `587` |
| `SMTP_USER` | l'adresse qui envoie | `reservations@kawtar.ca` |
| `SMTP_PASS` | **mot de passe d'application** | *(voir plus bas)* |
| `RESERVE_TO` | où arrivent les réservations (séparées par des virgules) | `bonjour@kawtar.ca` |
| `RESERVE_FROM` | *(optionnel)* en-tête From, défaut = `SMTP_USER` | |

Après avoir ajouté les variables : **Deployments → Redeploy** (les variables ne
s'appliquent qu'au prochain déploiement).

### Réglages selon le fournisseur

**Gmail / Google Workspace** — `smtp.gmail.com`, port `587`.
Il faut un *mot de passe d'application* : activer la validation en 2 étapes, puis
Compte Google → Sécurité → Mots de passe des applications → générer.
Le mot de passe normal **ne fonctionne pas**.

**Microsoft 365 / Outlook** — `smtp.office365.com`, port `587`.

**GoDaddy (boîte incluse avec le domaine)** — `smtpout.secureserver.net`, port `587`.

## Sécurité intégrée
- Champ piège (honeypot) — les robots sont ignorés silencieusement
- Limite de 8 réservations/heure par adresse IP
- Validation des champs + longueurs maximales, format date/heure vérifié
- Les identifiants SMTP restent côté serveur (jamais dans le navigateur)

## Comportement en cas d'échec
Si le courriel ne part pas, l'API renvoie une erreur et le site affiche
« Nous n'avons pas pu envoyer votre demande — appelez-nous au 514 891-0831 ».
**Le client n'est jamais faussement confirmé.**

## Tester
Après le déploiement, faire une vraie réservation sur kawtar.ca.
Si rien n'arrive : Vercel → **Logs** → filtrer `reserve` (les erreurs y sont
journalisées, ex. `missing env vars` ou identifiants SMTP refusés).
