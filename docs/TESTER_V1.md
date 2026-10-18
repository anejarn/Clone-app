# Tester la V1.0 de Sigma sur ton ordinateur

## 1. Installer (une seule fois)

Il faut : Node 22.18 ou plus récent, pnpm, Docker Desktop (pour Postgres) et Git.

```bash
git clone https://github.com/anejarn/Clone-app.git sigma
cd sigma
git checkout sigma/v1
cp .env.example .env
# Ouvre .env et mets une valeur dans BETTER_AUTH_SECRET (par ex. le résultat de : openssl rand -base64 32)
docker compose up -d          # démarre Postgres
pnpm install
pnpm db:deploy && pnpm db:seed   # crée la base et les données de démonstration
```

## 2. Lancer

```bash
pnpm dev        # le site : http://localhost:3000
pnpm worker     # dans un 2e terminal : synchronisation iCal et tâches de fond (facultatif pour tester)
```

## 3. Se connecter

Mot de passe de tous les comptes de démonstration : `sigma-demo-2026`.

| Compte | Rôle | Double authentification |
|---|---|---|
| `amine@demo.sigma.test` | associé (admin) | code de secours `demo0-00001` (puis `demo0-00002`…), ou la clé TOTP du README dans une appli d'authentification |
| `felicia@demo.sigma.test` | associé | à configurer à la première visite (scanne le QR code avec Google Authenticator) |
| `agent1@demo.sigma.test` | agent terrain | mêmes codes de secours que Amine |
| `voyageur1@demo.sigma.test` | voyageur | aucune |

Chaque code de secours ne marche qu'une fois. Si tu les as tous utilisés, relance `pnpm db:seed`.

## 4. Quoi tester (V1.0)

- **Espace équipe** : http://localhost:3000/admin
  - Biens : créer un bien, ajouter des photos, autorisation 80-14, guide d'accueil, onglet Plateformes.
  - Calendrier et Réservations : saisir une réservation par téléphone, un blocage propriétaire, essayer de créer un chevauchement.
  - Prix : créer une saison ou un événement, voir le calendrier des prix.
  - Utilisateurs : inviter un agent (lien à copier).
  - Opérations / Mes tâches / Ma journée (sur téléphone) / Pannes.
  - Déclarations : fiches voyageurs, export CSV DGSN, taxe de séjour ; Paramètres.
  - Synchronisation : liens iCal, conflits, « Déposer un e-mail », prix à reporter.
- **Guide d'accueil voyageur** (démo) :
  - séjour en cours, codes visibles : http://localhost:3000/guide/demo-guide-current-stay-0000000000000000000
  - séjour à venir, en anglais : http://localhost:3000/guide/demo-guide-upcoming-stay-000000000000000000
- **Site voyageur** : http://localhost:3000 (recherche, fiche logement, réservation directe).

## 5. Valeurs provisoires à confirmer avant la vraie mise en service

- Délai de conservation des pièces d'identité (365 jours provisoire) — avocat / CNDP.
- Format exact de la télé-déclaration DGSN.
- Taux et exonérations de la taxe de séjour (aucun taux réel saisi ; démo : 10 MAD fictif).
- Numéros de la conciergerie et numéros d'urgence affichés dans le guide.
- Choix à faire : hébergeur (et pays des données), fournisseur e-mail / WhatsApp, service de réception des e-mails de réservation.

## Pas encore dans la V1.0 (prévu V1.1)

Catalogue de services et demandes aux partenaires (lot 4b), finances et portail propriétaire (lot 6), messagerie et tableau de bord complet (lot 8).
