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

---

# Livraison — Uber Direct

Livraison en marque blanche : **nos** commandes, livrées par des coursiers Uber, sans
passer par Uber Eats et sans commission (tarif à la course, à partir de ~7 $ CA).

```
Client paie → /api/delivery/quote (prix + ETA, avant paiement)
            → /api/delivery/create (après paiement : dispatch du coursier)
            → Uber → /api/delivery/webhook (assigné → ramassé → livré)
```

| Endpoint | Rôle |
|---|---|
| `POST /api/delivery/quote` | Frais + ETA pour une adresse (valide 15 min) |
| `POST /api/delivery/create` | Dispatch après paiement · `prep_minutes` = le coursier arrive quand la nourriture est prête |
| `GET  /api/delivery/status?id=` | Statut en direct d'une livraison |
| `POST /api/delivery/webhook` | Reçoit les changements de statut d'Uber (signature HMAC vérifiée) |

## Configuration

1. Compte sur **direct.uber.com** → onglet **Developer** → copier les 3 identifiants
   **Test mode** (puis Production après approbation + facturation).
2. Vercel → projet kawtar → **Environment Variables** :
   `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET`, `UBER_DIRECT_CUSTOMER_ID`,
   `UBER_DIRECT_WEBHOOK_SECRET` → **Redeploy**.
3. Dans le dashboard Uber → Developer → **Webhooks** → URL :
   `https://www.kawtar.ca/api/delivery/webhook`
4. Adresse de ramassage et téléphone du resto : `api/_lib/uber.js` (`PICKUP`),
   surchargeables via `PICKUP_*`.

## Test local (sandbox, rien n'est facturé)

```bash
cp .env.local.example .env.local   # puis remplir les UBER_DIRECT_*
node scripts/uber-sandbox-test.js  # token → devis → livraison → statut
```

En mode test, Uber simule un « robo-coursier » qui fait avancer la livraison tout seul.
