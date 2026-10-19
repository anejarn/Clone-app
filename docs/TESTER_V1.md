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
  - Conciergerie (voir ci-dessous).
- **Guide d'accueil voyageur** (démo) :
  - séjour en cours, codes visibles : http://localhost:3000/guide/demo-guide-current-stay-0000000000000000000
  - séjour à venir, en anglais : http://localhost:3000/guide/demo-guide-upcoming-stay-000000000000000000
- **Site voyageur** : http://localhost:3000 (recherche, fiche logement, réservation directe).

### Tester la conciergerie (catalogue et demandes)

Les partenaires et les prix de démonstration sont **fictifs** (noms « (démo) », numéros +212 600 000 1xx qui n'existent pas).

1. Connecte-toi avec `amine@demo.sigma.test` et ouvre **Conciergerie** : 8 services (voiture, Ourika, Agafay, transfert, chef, hammam, ménage, courses sur devis) avec prix de vente, prix partenaire et marge. Filtre par catégorie.
2. **Partenaires** : ajoute un partenaire (au moins un contact, et celui du canal préféré). **Nouveau service** : titre en français (espagnol et anglais facultatifs), tarification (unité, personne, jour, trajet, sur devis), prix de vente et prix partenaire en dirhams — la marge s'affiche en direct ; une marge négative est refusée. Ajoute une option (par ex. « Siège bébé », par unité) et une photo.
3. Ouvre le guide du séjour en cours (lien ci-dessus) → section **Services** : choisis un service, une date pendant le séjour, une heure, le nombre de personnes, les options, ton téléphone → « Envoyer la demande ». Essaie une date hors du séjour, ou trop proche (délai de prévenance) : la demande est refusée, dans la langue du guide (FR · ES · EN). La demande apparaît dans « Vos demandes » avec son statut et « À régler sur place ou à la conciergerie ».
4. Dans **Demandes de services** : ouvre la demande. « Ouvrir WhatsApp » / « Ouvrir l'e-mail » ouvrent le message prérempli pour le partenaire (aucun envoi automatique tant qu'un fournisseur n'est pas choisi), puis « Marquer comme transmise ». Pour un service sur devis, fixe le **prix final** avant de confirmer. « Confirmer », puis **Paiement** (espèces, carte sur place, virement), puis « Marquer comme réalisée ». Chaque étape est dans le journal.
5. Change le prix d'un service : les demandes déjà faites gardent leur prix. Le **tableau de bord** montre les nouvelles demandes et la marge du mois (demandes confirmées et réalisées).
6. Connecte-toi avec `agent1@demo.sigma.test` : Conciergerie montre le catalogue avec les seuls prix de vente, sans partenaires ni marges ; les demandes ne lui sont pas accessibles.

## 5. Valeurs provisoires à confirmer avant la vraie mise en service

- Délai de conservation des pièces d'identité (365 jours provisoire) — avocat / CNDP.
- Format exact de la télé-déclaration DGSN.
- Taux et exonérations de la taxe de séjour (aucun taux réel saisi ; démo : 10 MAD fictif).
- Numéros de la conciergerie et numéros d'urgence affichés dans le guide.
- Partenaires, services et prix de la conciergerie (ceux de la démo sont fictifs) ; envoi automatique aux partenaires dès qu'un fournisseur WhatsApp / e-mail est choisi.
- Choix à faire : hébergeur (et pays des données), fournisseur e-mail / WhatsApp, service de réception des e-mails de réservation.

## Pas encore dans la V1.0 (prévu V1.1)

Finances et portail propriétaire (lot 6), messagerie et tableau de bord complet (lot 8). Paiement en ligne des services : V2 (CMI).
