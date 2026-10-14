# Sigma — Tâches pour Claude Code

À placer à la racine du dépôt `anejarn/clone-app`, à côté de `CLAUDE.md`.
Partir de la branche `claude/replica-recon-y2v1vg` et travailler sur une nouvelle branche `sigma/v1`.

## Règles de travail

- Un lot à la fois, dans l'ordre. Ne pas commencer un lot tant que le précédent n'est pas vert.
- Un lot est « vert » quand ces commandes passent : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, puis `pnpm test:e2e`.
- Après chaque lot : commit, push sur `sigma/v1`, puis cocher les cases de ce fichier.
- Me demander avant tout choix irréversible : hébergeur, fournisseur de paiement, suppression de données.
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
- [ ] **Multi-organisation (prépare la V3)** : table `Organization` et `organizationId` sur les utilisateurs, biens, réservations et toutes les tables métier créées ensuite. Chaque requête filtre par organisation, avec des tests qui prouvent qu'une organisation ne voit jamais les données d'une autre. Les rôles (ADMIN, AGENT, OWNER) s'appliquent à l'intérieur d'une organisation. Sigma est la première organisation.

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

## Lot 7 — Synchronisation avec les plateformes (sans channel manager payant)

L'application Sigma est le calendrier central de chaque bien. Chaque plateforme importe le calendrier Sigma, et Sigma importe le calendrier de chaque plateforme. Une réservation prise sur Airbnb bloque donc les dates dans Sigma, puis sur Booking, Agoda, etc.

- [ ] Couche d'adaptation `lib/channels/` avec une interface commune, pour pouvoir brancher plus tard une API officielle sans tout réécrire.
- [ ] **Export** : un lien `.ics` secret par bien et par plateforme, qui contient toutes les dates occupées (réservations de toutes les sources et blocages propriétaires). Lien révocable et régénérable. On exclut de l'export de chaque plateforme ses propres réservations, pour éviter les boucles.
- [ ] **Import** : pour chaque bien, enregistrer le lien iCal de chaque plateforme (Airbnb, Booking.com, Agoda, Trip.com, Vrbo…). Lecture automatique toutes les 10 minutes, plus un bouton « Synchroniser maintenant ».
- [ ] Chaque événement importé crée ou met à jour une réservation (source = plateforme, `externalRef` = identifiant iCal). Un événement qui disparaît du fichier annule la réservation correspondante.
- [ ] **Protection contre les doubles réservations** :
  - détection immédiate des conflits (deux réservations sur les mêmes nuits), avec une alerte WhatsApp et e-mail à l'équipe et un bandeau rouge dans le back-office ;
  - délai de préparation et préavis minimum réglables par bien (par exemple pas de réservation le jour même), à reporter aussi dans les paramètres de chaque plateforme ;
  - alerte si un lien iCal ne répond plus ou n'a pas été lu depuis plus d'une heure (une synchronisation cassée ne prévient pas d'elle-même).
- [ ] Journal de chaque synchronisation (heure, nombre d'événements, erreurs).
- [ ] Les prix ne passent pas par iCal : afficher dans le back-office un rappel des prix à reporter sur chaque plateforme quand un prix change dans Sigma.
- [ ] Guide pas à pas dans l'application pour connecter un bien à chaque plateforme (où trouver le lien d'import et d'export).
- [ ] Tests : import, mise à jour, annulation, conflit, flux indisponible, fichier invalide, fuseau horaire.
- [ ] Plus tard (pas en V1) : demander l'accès aux API officielles d'Airbnb et de Booking.com, pour synchroniser en temps réel et transmettre les prix. Ces accès demandent une revue de sécurité et l'accord de chaque plateforme.

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

Même règles : un lot à la fois, tout vert avant le suivant.

### V2-1 — Paiement en ligne
- [ ] **Me demander** le fournisseur avant de coder : passerelle CMI de la banque de Sigma pour les cartes marocaines, et lien de paiement international pour les voyageurs étrangers.
- [ ] Paiement des réservations directes et des services de conciergerie, avec acompte ou paiement total selon le cas.
- [ ] Remboursements et annulations selon la politique d'annulation de chaque bien.
- [ ] Aucune donnée de carte stockée chez Sigma (tout passe par le fournisseur), et reçu envoyé par e-mail.
- [ ] Rapprochement automatique des paiements avec les finances du lot 6, avec tests.

### V2-2 — Portail partenaires
- [ ] Rôle PARTNER (loueurs de voitures, guides, chefs, transporteurs).
- [ ] Le partenaire reçoit les demandes, accepte ou refuse, et confirme la prestation.
- [ ] Il voit ses prestations et ses montants dus, mais jamais les données des autres partenaires ni la marge de Sigma.
- [ ] Relevé mensuel par partenaire.

### V2-3 — Site de réservation directe complet
- [ ] Construire la page détaillée du logement, qui manque dans le clone : photos, équipements, carte, règles, avis, calendrier et prix.
- [ ] Tunnel de réservation avec paiement (V2-1) et guide d'accueil envoyé automatiquement.
- [ ] Référencement naturel (pages par quartier), multilingue, et codes promo pour les clients fidèles.
- [ ] Disponibilités toujours issues du calendrier central Sigma (lot 7), pour éviter les doubles réservations.

### V2-4 — Prix dynamique
- [ ] Ajuster les prix selon la saison, les événements de Marrakech, le taux de remplissage et le délai avant l'arrivée.
- [ ] Prix plancher et plafond par bien, fixés avec le propriétaire.
- [ ] Toute modification de prix est journalisée et peut être annulée.
- [ ] Possibilité de brancher un outil externe de prix dynamique à la place.

### V2-5 — Syndic de copropriété (loi 18-00 modifiée par 106-12 et 30-24)
- [ ] Rôle COOWNER (copropriétaire) et accès conseil syndical.
- [ ] Copropriétés, bâtiments, lots et tantièmes.
- [ ] Budget prévisionnel annuel, appels de charges par lot selon les tantièmes, fonds de travaux.
- [ ] Encaissements, relances et suivi des impayés, avec historique par copropriétaire.
- [ ] Factures fournisseurs scannées et consultables, et comptabilité de la copropriété séparée de celle de Sigma.
- [ ] Tickets pour les parties communes (ascenseur, piscine, jardins, éclairage) avec suivi.
- [ ] Convocation à l'assemblée générale, ordre du jour, vote électronique et procès-verbal.
- [ ] Tableaux de bord de transparence pour les copropriétaires (dépenses, impayés, travaux).
- [ ] Tests sur tous les calculs de répartition de charges.

### V2-6 — Services aux résidents
- [ ] Maintenance privative (chaudière, climatisation) sur demande, avec devis et suivi.
- [ ] Commande et livraison de bonbonnes de gaz.
- [ ] Ménage à domicile sur réservation.
- [ ] Suivi à distance de l'appartement pour les MRE (photos, rapport de visite).

## V3 — Sigma devient un logiciel pour d'autres gestionnaires

Objectif : d'autres conciergeries et propriétaires utilisent l'application pour gérer leurs biens sur Airbnb, Booking, Agoda, etc., avec un abonnement payé à Sigma. À commencer quand la V1 tourne bien chez Sigma. La séparation des données est préparée dès le lot 1.

### V3-1 — Organisations et inscription
- [ ] Page d'inscription d'une organisation (conciergerie ou propriétaire) avec vérification de l'e-mail.
- [ ] Assistant de démarrage : informations de l'organisation (nom, ICE, adresse), premier bien, connexion des calendriers des plateformes (lot 7), invitation de l'équipe.
- [ ] Gestion des membres et des rôles par organisation ; une personne peut appartenir à plusieurs organisations et choisir laquelle utiliser.
- [ ] Les données de Sigma (ses biens, ses propriétaires, ses finances) restent invisibles pour les autres organisations, et inversement.

### V3-2 — Abonnements et facturation
- [ ] **Me demander** les formules et les prix avant de coder (par exemple un prix par logement et par mois, avec des paliers).
- [ ] Période d'essai gratuite, passage à l'abonnement payant, changement de formule.
- [ ] Factures conformes au Maroc (ICE de Sigma et du client, TVA), numérotées et téléchargeables en PDF.
- [ ] Paiement de l'abonnement par le fournisseur choisi en V2-1, relances automatiques, suspension en lecture seule en cas d'impayé, puis réactivation.
- [ ] Limites selon la formule (nombre de biens, d'utilisateurs, de modules) avec des messages clairs.

### V3-3 — Modules pour les clients
- [ ] Chaque organisation peut activer les modules dont elle a besoin : calendrier et synchronisation des plateformes, opérations terrain, guide d'accueil, déclaration voyageurs, finances et relevés propriétaires, conciergerie, syndic.
- [ ] Les paramètres propres à Sigma (commission, partenaires, catalogue de services) deviennent des paramètres par organisation.

### V3-4 — Personnalisation
- [ ] Logo, couleurs et nom de l'organisation sur le guide d'accueil, les relevés et les e-mails envoyés aux voyageurs et aux propriétaires.
- [ ] Langues par défaut de l'organisation.
- [ ] Plus tard : domaine personnalisé pour le site de réservation directe du client.

### V3-5 — Administration de la plateforme (pour l'équipe Sigma)
- [ ] Rôle SUPERADMIN, distinct des rôles d'organisation, avec double authentification obligatoire.
- [ ] Liste des organisations clientes : formule, nombre de biens, usage, état des paiements, santé des synchronisations.
- [ ] Support : tickets des clients, et accès à l'espace d'un client uniquement avec son accord, limité dans le temps et journalisé.
- [ ] Indicateurs : clients actifs, revenus d'abonnement mensuels, résiliations.

### V3-6 — Sécurité, conformité et données des clients
- [ ] Tests automatiques d'isolation sur chaque route et chaque action : aucune fuite de données entre organisations.
- [ ] Conditions générales d'utilisation, politique de confidentialité et contrat de traitement des données (Sigma est sous-traitant des données de ses clients au sens de la loi 09-08) ; mise à jour de la déclaration CNDP.
- [ ] Export complet des données d'une organisation (CSV et PDF), et suppression définitive à la résiliation après un délai annoncé.
- [ ] Sauvegardes quotidiennes et procédure de restauration testée.
- [ ] Limites d'usage pour protéger la plateforme (nombre de requêtes, taille des fichiers, fréquence des synchronisations).

### V3-7 — Site commercial et aide
- [ ] Page de présentation du logiciel, des formules et des tarifs, en français, arabe et anglais.
- [ ] Centre d'aide : guides pas à pas, notamment la connexion des calendriers Airbnb, Booking, Agoda et Trip.com.
- [ ] Formulaire de contact et demande de démonstration.

### V3-8 — Connexion officielle aux plateformes
- [ ] Quand la plateforme compte assez de logements, demander l'accès aux API officielles d'Airbnb et de Booking.com (revue de sécurité, accord de chaque plateforme) pour une synchronisation en temps réel et le transfert des prix.
- [ ] Brancher ces API dans la couche d'adaptation `lib/channels/` du lot 7, sans changer le reste de l'application.
