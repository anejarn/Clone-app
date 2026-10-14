# Sigma — Tâches pour Claude Code

À placer à la racine du dépôt `anejarn/clone-app`, à côté de `CLAUDE.md`.
Partir de la branche `claude/replica-recon-y2v1vg` et travailler sur une nouvelle branche `sigma/v1`.

## Règles de travail

- Un lot à la fois, dans l'ordre. Ne pas commencer un lot tant que le précédent n'est pas vert.
- Un lot est « vert » quand ces commandes passent : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, puis `pnpm test:e2e`.
- Après chaque lot : commit, push sur `sigma/v1`, puis cocher les cases de ce fichier.
- Me demander avant tout choix irréversible : hébergeur, channel manager, fournisseur de paiement, suppression de données.
- Montants en centimes de dirham (MAD). Fuseau horaire `Africa/Casablanca`. Dates affichées en JJ/MM/AAAA.
- Tests obligatoires pour tout calcul d'argent : commissions, relevés, taxe de séjour.

---

## Lot 0 — Identité Sigma

Objectif : plus aucune trace visible de « Nidou » ou d'Airbnb.

- [ ] Renommer Nidou en Sigma partout :
  - `components/layout/Logo.tsx` (nouveau logo, pas celui d'Airbnb), `app/layout.tsx` (titre et description), `components/home/HomePage.tsx`, `lib/server/auth.ts` (`appName`) ;
  - clés `nidou_consent` (`components/layout/CookieConsent.tsx`, `tests/e2e/fixtures.ts`) et `nidou:wishlist` (`lib/wishlist.ts`, `tests/unit/wishlist-store.test.ts`) ;
  - bases `nidou`/`nidou_test` (`docker-compose.yml`, `prisma/docker-init.sql`, `.env.example`, `.github/workflows/ci.yml`, `playwright.config.ts`, `tests/integration/global-setup.ts`) ;
  - e-mails `@demo.nidou.fr` et `@test.nidou.fr` dans `prisma/seed.ts`, `prisma/fixtures.ts` et les tests ;
  - `package.json` (`name`).
- [ ] Couleurs : remplacer le rose Airbnb (`#ff385c`, `#da1249` et le dégradé dans `app/globals.css`) par une couleur Sigma, par exemple le bleu Majorelle (`#3550a8`, foncé `#233c8c`). Mettre à jour `tests/e2e/design.spec.ts` (couleur du bouton de recherche).
- [ ] Textes : réécrire `components/layout/Footer.tsx` (colonnes Assistance / Propriétaires / Sigma, « © Sigma SARL, Marrakech », « MAD », « Français (MA) »). Dans `components/layout/UserMenu.tsx`, « Devenir hôte » devient « Confier mon bien ».
- [ ] Monnaie : `lib/format.ts`, `formatEuros` devient `formatPrice` en MAD (« 1 392 MAD ») ; mettre à jour `app/trips/page.tsx`, `lib/server/cards.ts`, `tests/unit/format.test.ts`.
- [ ] Frais de service voyageur : `SERVICE_FEE_RATE` passe à 0 dans `lib/pricing.ts` (Sigma n'est pas une place de marché) ; adapter `tests/unit/rules.test.ts`.
- [ ] Données de démo (`prisma/fixtures.ts`) : remplacer les villes françaises par les quartiers de Marrakech (Hivernage, Guéliz, Médina, Palmeraie, Agdal, Targa, Route de l'Ourika, Agafay, Semlalia, Ménara), fuseau `Africa/Casablanca`, prix en MAD, prénoms locaux, activités locales (Ourika, Agafay, cuisine marocaine, médina, montgolfière, hammam). Garder au moins 10 lieux (le test de design compte 10 tuiles).
- [ ] Contenus (`lib/content.ts`) : services de conciergerie (voitures, transferts aéroport, excursions, chef, hammam, ménage, courses, photographe) et liens d'inspiration vers les quartiers.
- [ ] Sections de l'accueil (`lib/server/catalog.ts`, fonction `homeSections`) : « Quartiers de Marrakech », « Services de conciergerie Sigma », « Logements populaires · Hivernage », « Villas avec piscine · Palmeraie », « Activités populaires · Marrakech », etc.
- [ ] Mettre à jour tous les tests qui citent Paris, Lyon, Annecy, Chamonix, Nice… (`tests/integration/*`, `tests/e2e/*`, `tests/unit/search-draft.tz.test.tsx`, `tests/unit/safe-redirect.test.ts`). Réécrire `tests/integration/timezones.test.ts` avec Marrakech, en choisissant une date hors Ramadan (le Maroc passe alors en UTC+0).
- [ ] Mettre à jour le README (nom, bases de données, état des lots).

## Lot 1 — Modèle de données Sigma

- [ ] Rôles : enum `Role` (ADMIN = associé, AGENT = agent terrain, OWNER = propriétaire, GUEST = voyageur) et champ `role` sur `User` (par défaut GUEST, jamais choisi à l'inscription) ; champ `phone`. Supprimer `isProfessional` et l'étiquette « Particulier / Professionnel » des cartes (`lib/server/cards.ts`, `components/listing/ListingCard.tsx`).
- [ ] Logements : `hostId` devient `ownerId` (propriétaire). Ajouter `managementType` (MANAGED = mandat de gestion, SUBLEASE = sous-location), `commissionBps` (2000 = 20 %), `address`, `licenseNumber` et `licenseExpiresAt` (autorisation loi 80-14), `minNights`. Ajouter `RIAD` aux types de logement. Ne plus exposer le propriétaire dans l'API publique du logement.
- [ ] Réservations : `source` (DIRECT, AIRBNB, BOOKING, AGODA, TRIPCOM, EXPEDIA, OWNER pour un blocage propriétaire), `externalRef` (code de la plateforme, unique par source), `guestId` optionnel, plus `guestName`, `guestEmail`, `guestPhone` pour les voyageurs sans compte.
- [ ] Migration SQL qui s'applique sur une base existante, avec les contraintes : commission entre 0 et 10000, un blocage propriétaire sans montant ni voyageur, une réservation de plateforme toujours avec `externalRef`. La règle « pas de chevauchement » (`bookings_no_overlap`) doit aussi bloquer les blocages propriétaires.
- [ ] Faire respecter `minNights` dans `quoteStay` (`lib/server/bookings.ts`).
- [ ] Seed : 3 associés (ADMIN), 2 agents, 6 à 8 propriétaires, quelques sous-locations, des réservations Airbnb, Booking, Agoda et Trip.com sans compte voyageur, et quelques blocages propriétaires.
- [ ] Tests : rôles par défaut, contraintes de la base, blocages, unicité de `externalRef`.

## Lot 2 — Back-office (équipe Sigma)

- [ ] Espace `/admin`, accessible aux seuls ADMIN (et en partie aux AGENT), avec contrôle d'accès côté serveur sur chaque route et chaque action, et des tests d'accès refusé.
- [ ] Double authentification pour ADMIN et AGENT (plugin `twoFactor` de Better Auth).
- [ ] Gestion des biens : liste, fiche, création et modification (photos, équipements, adresse, autorisation 80-14 avec alerte 60 jours avant expiration, commission, type de gestion).
- [ ] Gestion des utilisateurs : inviter un propriétaire ou un agent, changer un rôle.
- [ ] Calendrier unifié de tous les biens (réservations par couleur de source, blocages propriétaires).
- [ ] Saisie manuelle d'une réservation (téléphone, WhatsApp) et d'un blocage propriétaire.
- [ ] Prix : prix par saison et par événement, durée minimale (`minNights`).

## Lot 3 — Opérations terrain (sur téléphone)

- [ ] Tâches créées automatiquement à chaque réservation : ménage après départ, préparation du linge, accueil à l'arrivée.
- [ ] Affectation à un agent, statut (à faire, en cours, fait), check-list avec photos obligatoires.
- [ ] Signalement de panne avec photo, priorité et suivi jusqu'à la résolution.
- [ ] Vue « Ma journée » pour l'agent, installable sur téléphone (PWA), qui fonctionne hors connexion et se synchronise au retour du réseau.

## Lot 4 — Guide d'accueil et conciergerie

- [ ] Page web unique par réservation, avec un lien secret : accès, Wi-Fi, règles de la maison, recommandations, contact. Les codes d'accès ne sont visibles qu'entre l'arrivée et le départ.
- [ ] Catalogue de services : voitures, activités, transferts, chef, hammam, ménage, courses (prix de vente, prix partenaire, marge).
- [ ] Demande de service depuis le guide, transmise au partenaire par WhatsApp ou e-mail, avec un statut et la marge enregistrée.
- [ ] Multilingue côté voyageur : français, espagnol, anglais (prévoir l'ajout des autres langues).

## Lot 5 — Déclaration des voyageurs et taxe de séjour

- [ ] Saisie des pièces d'identité au check-in (stockage chiffré, accès réservé, suppression automatique après le délai légal).
- [ ] Export pour la télé-déclaration DGSN.
- [ ] Calcul de la taxe de séjour par nuit et par voyageur, avec le taux paramétrable, et ses tests.

## Lot 6 — Finances et portail propriétaire

- [ ] À chaque réservation, enregistrer la répartition : revenu, commission Sigma, part propriétaire, frais de plateforme, ménage. Pour une sous-location, tout le revenu revient à Sigma (le loyer au propriétaire est une dépense).
- [ ] Dépenses refacturées au propriétaire (réparations, achats) avec justificatif.
- [ ] Relevé mensuel PDF par propriétaire.
- [ ] Export comptable (CSV) et journal de toutes les opérations financières (qui, quand, quoi).
- [ ] Portail propriétaire en lecture seule : ses biens, ses réservations, ses revenus, ses relevés, ses documents. Un propriétaire ne voit jamais les données d'un autre (tests à l'appui).
- [ ] Tests sur tous les calculs : arrondis, sommes toujours égales au total, mois à cheval.

## Lot 7 — Channel manager

- [ ] Créer une interface d'adaptation (`lib/channels/`) : lire les réservations, pousser disponibilités et prix, recevoir les notifications.
- [ ] Faire d'abord un adaptateur simulé, utilisé par les tests.
- [ ] **Me demander** quel channel manager choisir (Guesty, Smoobu ou Lodgify) avant d'écrire le vrai adaptateur.
- [ ] Synchronisation par API, avec Airbnb, Booking.com, Agoda et Trip.com en priorité. Pas de synchronisation iCal comme solution principale.

## Lot 8 — Messagerie et tableau de bord

- [ ] Boîte de réception unique : messages des plateformes, WhatsApp et e-mail.
- [ ] Messages automatiques avant, pendant et après le séjour, dans la langue du voyageur.
- [ ] Tableau de bord Sigma : occupation, revenu par nuit disponible, chiffre d'affaires par source, avis, alertes (autorisation 80-14 qui expire, panne ouverte, ménage en retard).

## Avant la mise en ligne

- [ ] Interface équipe et propriétaires en français, arabe (de droite à gauche) et anglais.
- [ ] Déclaration CNDP (loi 09-08) prête : liste des données personnelles traitées.
- [ ] Sauvegarde quotidienne de la base.
- [ ] **Me demander** le choix de l'hébergeur avant de déployer.

## Version 2 (après validation de la V1)

Paiement en ligne (CMI et lien international), portail partenaires, module syndic (loi 18-00 modifiée par 106-12 et 30-24), services aux résidents, site de réservation directe complet, prix dynamique.
