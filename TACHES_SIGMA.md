# Sigma — Tâches pour Claude Code

À placer à la racine du dépôt `anejarn/clone-app`, à côté de `CLAUDE.md`.
Partir de la branche `claude/replica-recon-y2v1vg` et travailler sur une nouvelle branche `sigma/v1`.

## Règles de travail

- Un lot à la fois, dans l'ordre. Ne pas commencer un lot tant que le précédent n'est pas vert.
- Un lot est « vert » quand ces commandes passent : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, puis `pnpm test:e2e`.
- Après chaque lot : commit, push sur `sigma/v1`, puis cocher les cases de ce fichier.
- Me demander avant tout choix irréversible : hébergeur (et pays où sont stockées les données), fournisseur de paiement, fournisseur WhatsApp, fournisseur d'IA, service de réception des e-mails, marque de serrures, suppression de données.
- Montants en centimes de dirham (MAD). Fuseau horaire `Africa/Casablanca`. Dates affichées en JJ/MM/AAAA.
- Tests obligatoires pour tout calcul d'argent : commissions, relevés, taxe de séjour.

## Plan de livraison (revue d'architecture du 17/10/2026)

Les 14 lots de la V1 ne tiennent pas d'ici janvier 2027 avec un seul développeur. La V1 est donc livrée en trois étapes, sans rien retirer :

| Étape | Date visée | Lots | Objectif |
| --- | --- | --- | --- |
| V1.0 « Démarrage » | Janvier 2027 | 0, 1, 2, 3 (tâches de ménage simples), 4 (guide d'accueil simple), 5, 7 (iCal + lecture des e-mails Airbnb et Booking.com) | Louer les premiers logements sans double réservation et en règle |
| V1.1 « Gestion complète » | Mars 2027 | 6, 7 (autres plateformes), 8, 9 (enregistrement en ligne) | Rendre des comptes aux propriétaires d'Othman |
| V1.2 « Niveau mondial » | Juin 2027 | 9 (assistant IA), 10, 11, 12, 13 | Être au niveau des meilleurs logiciels |
| Pilote V3 | Octobre 2027 | V3-1 à V3-3 | 5 conciergeries pilotes, après 6 mois d'usage interne |

---

## Lot 0 — Identité Sigma

> État au 17/10/2026 : lot 0 terminé (commit 985efad) : nom, logo, bleu Majorelle, MAD, quartiers de Marrakech, frais de service à 0, bases `sigma`/`sigma_test`, e-mails `@*.sigma.test`. Tous les tests passent.

Objectif : plus aucune trace visible de « Nidou » ou d'Airbnb.

- [x] Renommer Nidou en Sigma partout :
  - `components/layout/Logo.tsx` (nouveau logo, pas celui d'Airbnb), `app/layout.tsx` (titre et description), `components/home/HomePage.tsx`, `lib/server/auth.ts` (`appName`) ;
  - clés `nidou_consent` (`components/layout/CookieConsent.tsx`, `tests/e2e/fixtures.ts`) et `nidou:wishlist` (`lib/wishlist.ts`, `tests/unit/wishlist-store.test.ts`) ;
  - bases `nidou`/`nidou_test` (`docker-compose.yml`, `prisma/docker-init.sql`, `.env.example`, `.github/workflows/ci.yml`, `playwright.config.ts`, `tests/integration/global-setup.ts`) ;
  - e-mails `@demo.nidou.fr` et `@test.nidou.fr` dans `prisma/seed.ts`, `prisma/fixtures.ts` et les tests ;
  - `package.json` (`name`).
- [x] Couleurs : remplacer le rose Airbnb (`#ff385c`, `#da1249` et le dégradé dans `app/globals.css`) par une couleur Sigma, par exemple le bleu Majorelle (`#3550a8`, foncé `#233c8c`). Mettre à jour `tests/e2e/design.spec.ts` (couleur du bouton de recherche).
- [x] Textes : réécrire `components/layout/Footer.tsx` (colonnes Assistance / Propriétaires / Sigma, « © Sigma SARL, Marrakech », « MAD », « Français (MA) »). Dans `components/layout/UserMenu.tsx`, « Devenir hôte » devient « Confier mon bien ».
- [x] Monnaie : `lib/format.ts`, `formatEuros` devient `formatPrice` en MAD (« 1 392 MAD ») ; mettre à jour `app/trips/page.tsx`, `lib/server/cards.ts`, `tests/unit/format.test.ts`.
- [x] Frais de service voyageur : `SERVICE_FEE_RATE` passe à 0 dans `lib/pricing.ts` (Sigma n'est pas une place de marché) ; adapter `tests/unit/rules.test.ts`.
- [x] Données de démo (`prisma/fixtures.ts`) : remplacer les villes françaises par les quartiers de Marrakech (Hivernage, Guéliz, Médina, Palmeraie, Agdal, Targa, Route de l'Ourika, Agafay, Semlalia, Ménara), fuseau `Africa/Casablanca`, prix en MAD, prénoms locaux, activités locales (Ourika, Agafay, cuisine marocaine, médina, montgolfière, hammam). Garder au moins 10 lieux (le test de design compte 10 tuiles).
- [x] Contenus (`lib/content.ts`) : services de conciergerie (voitures, transferts aéroport, excursions, chef, hammam, ménage, courses, photographe) et liens d'inspiration vers les quartiers.
- [x] Sections de l'accueil (`lib/server/catalog.ts`, fonction `homeSections`) : « Quartiers de Marrakech », « Services de conciergerie Sigma », « Logements populaires · Hivernage », « Villas avec piscine · Palmeraie », « Activités populaires · Marrakech », etc.
- [x] Mettre à jour tous les tests qui citent Paris, Lyon, Annecy, Chamonix, Nice… (`tests/integration/*`, `tests/e2e/*`, `tests/unit/search-draft.tz.test.tsx`, `tests/unit/safe-redirect.test.ts`). Réécrire `tests/integration/timezones.test.ts` avec Marrakech, en choisissant une date hors Ramadan (le Maroc passe alors en UTC+0).
- [x] Mettre à jour le README (nom, bases de données, état des lots).

## Lot 1 — Modèle de données Sigma

> État au 17/10/2026 : lot 1 terminé (migrations `20261017120000_organizations_and_roles`, `20261018090000_listing_owners`, `20261019090000_booking_sources`, `20261019100000_reviews_wishlists_organizations`). `externalRef` est unique par (organisation, source) et non globalement : deux gestionnaires (V3) peuvent importer le même flux, et un index global laisserait une organisation découvrir les réservations d'une autre. Montants d'une réservation : tous connus ou tous à NULL (blocage propriétaire toujours, réservation de plateforme tant que le montant n'est pas connu, l'iCal n'en donnant pas). Avis, listes de favoris et leurs éléments portent aussi `organizationId`, garanti par des clés étrangères composites.

- [x] Rôles : enum `Role` (ADMIN = associé, AGENT = agent terrain, OWNER = propriétaire, GUEST = voyageur) et champ `role` sur `User` (par défaut GUEST, jamais choisi à l'inscription) ; champ `phone`. Supprimer `isProfessional` et l'étiquette « Particulier / Professionnel » des cartes (`lib/server/cards.ts`, `components/listing/ListingCard.tsx`).
- [x] Logements : `hostId` devient `ownerId` (propriétaire). Ajouter `managementType` (MANAGED = mandat de gestion, SUBLEASE = sous-location), `commissionBps` (2000 = 20 %), `address`, `licenseNumber` et `licenseExpiresAt` (autorisation loi 80-14), `minNights`. Ajouter `RIAD` aux types de logement. Ne plus exposer le propriétaire dans l'API publique du logement.
- [x] Réservations : `source` (DIRECT, AIRBNB, BOOKING, AGODA, TRIPCOM, EXPEDIA, OWNER pour un blocage propriétaire), `externalRef` (code de la plateforme, unique par source), `guestId` optionnel, plus `guestName`, `guestEmail`, `guestPhone` pour les voyageurs sans compte.
- [x] Migration SQL qui s'applique sur une base existante, avec les contraintes : commission entre 0 et 10000, un blocage propriétaire sans montant ni voyageur, une réservation de plateforme toujours avec `externalRef`. La règle « pas de chevauchement » (`bookings_no_overlap`) doit aussi bloquer les blocages propriétaires.
- [x] Faire respecter `minNights` dans `quoteStay` (`lib/server/bookings.ts`).
- [x] Seed : 3 associés (ADMIN), 2 agents, 6 à 8 propriétaires, quelques sous-locations, des réservations Airbnb, Booking, Agoda et Trip.com sans compte voyageur, et quelques blocages propriétaires.
- [x] Tests : rôles par défaut, contraintes de la base, blocages, unicité de `externalRef`.
- [x] **Multi-organisation (prépare la V3)** : table `Organization` et `organizationId` sur les utilisateurs, biens, réservations et toutes les tables métier créées ensuite. Chaque requête filtre par organisation, avec des tests qui prouvent qu'une organisation ne voit jamais les données d'une autre. Les rôles (ADMIN, AGENT, OWNER) s'appliquent à l'intérieur d'une organisation. Sigma est la première organisation.

## Lot 2 — Back-office (équipe Sigma)

- [x] Espace `/admin`, accessible aux seuls ADMIN (et en partie aux AGENT), avec contrôle d'accès côté serveur sur chaque route et chaque action, et des tests d'accès refusé.
- [x] Double authentification pour ADMIN et AGENT (plugin `twoFactor` de Better Auth).
- [x] Gestion des biens : liste, fiche, création et modification (photos, équipements, adresse, autorisation 80-14 avec alerte 60 jours avant expiration, commission, type de gestion).
- [x] Gestion des utilisateurs : inviter un propriétaire ou un agent, changer un rôle.
- [x] Calendrier unifié de tous les biens (réservations par couleur de source, blocages propriétaires).
- [x] Saisie manuelle d'une réservation (téléphone, WhatsApp) et d'un blocage propriétaire.
- [x] Prix : prix par saison et par événement, durée minimale (`minNights`).

Lot 2 terminé (octobre 2026) : moteur de prix `lib/pricing/engine.ts` utilisé par le devis, la réservation, la recherche et la saisie manuelle ; règles de prix dans `/admin/prix` avec calendrier des prix par bien.

## Lot 3 — Opérations terrain (sur téléphone)

- [x] Tâches créées automatiquement à chaque réservation : ménage après départ, préparation du linge, accueil à l'arrivée.
- [x] Affectation à un agent, statut (à faire, en cours, fait), check-list avec photos obligatoires.
- [x] Signalement de panne avec photo, priorité et suivi jusqu'à la résolution.
- [x] Vue « Ma journée » pour l'agent, installable sur téléphone (PWA), qui fonctionne hors connexion et se synchronise au retour du réseau.

## Lot 4 — Guide d'accueil et conciergerie

> État au 19/10/2026 : lot 4 terminé. Lot 4b (migrations `20261031090000_conciergerie`, `20261031090100_conciergerie_status_check`, `20261031090200_services_title_check`) : partenaires et catalogue par organisation (`/admin/conciergerie`, gestion réservée aux associés, les agents voient le catalogue avec les seuls prix de vente), demandes depuis le guide avec prix figé au moment de la demande, délai de prévenance et dates du séjour vérifiés (heure de Marrakech), envoi au partenaire par lien wa.me / mailto prérempli (aucun fournisseur WhatsApp / e-mail choisi : `lib/notifications` ne livre rien en attendant), statut, prix final avant confirmation, paiement sur place enregistré (espèces comprises), compteur et marge du mois au tableau de bord. Paiement en ligne : V2 (CMI).

- [x] Page web unique par réservation, avec un lien secret : accès, Wi-Fi, règles de la maison, recommandations, contact. Les codes d'accès ne sont visibles qu'entre l'arrivée et le départ.
- [x] Catalogue de services : voitures, activités, transferts, chef, hammam, ménage, courses (prix de vente, prix partenaire, marge).
- [x] Demande de service depuis le guide, transmise au partenaire par WhatsApp ou e-mail, avec un statut et la marge enregistrée.
- [x] Multilingue côté voyageur : français, espagnol, anglais (prévoir l'ajout des autres langues).

## Lot 5 — Déclaration des voyageurs et taxe de séjour

- [x] Saisie des pièces d'identité au check-in (stockage chiffré, accès réservé, suppression automatique après le délai légal).
- [x] Export pour la télé-déclaration DGSN.
- [x] Calcul de la taxe de séjour par nuit et par voyageur, avec le taux paramétrable, et ses tests.

## Lot 6 — Finances et portail propriétaire

- [x] À chaque réservation, enregistrer la répartition : revenu, commission Sigma, part propriétaire, frais de plateforme, ménage. Pour une sous-location, tout le revenu revient à Sigma (le loyer au propriétaire est une dépense). (lot 6a : Finances, journal en ajout seul, clôture mensuelle, mois à cheval par nuits, taux de change saisi ; règles à confirmer avec le comptable, voir README « Finances »)
- [x] Dépenses refacturées au propriétaire (réparations, achats) avec justificatif.
- [ ] Relevé mensuel PDF par propriétaire.
- [x] Export comptable (CSV) et journal de toutes les opérations financières (qui, quand, quoi).
- [ ] Portail propriétaire en lecture seule : ses biens, ses réservations, ses revenus, ses relevés, ses documents. Un propriétaire ne voit jamais les données d'un autre (tests à l'appui).
- [x] Tests sur tous les calculs : arrondis, sommes toujours égales au total, mois à cheval.

## Lot 7 — Synchronisation avec les plateformes (sans channel manager payant)

L'application Sigma est le calendrier central de chaque bien. Chaque plateforme importe le calendrier Sigma, et Sigma importe le calendrier de chaque plateforme. Une réservation prise sur Airbnb bloque donc les dates dans Sigma, puis sur Booking, Agoda, etc.

- [x] Couche d'adaptation `lib/channels/` avec une interface commune, pour pouvoir brancher plus tard une API officielle sans tout réécrire.
- [x] **Export** : un lien `.ics` secret par bien et par plateforme, qui contient toutes les dates occupées (réservations de toutes les sources et blocages propriétaires). Lien révocable et régénérable. On exclut de l'export de chaque plateforme ses propres réservations, pour éviter les boucles.
- [x] **Import** : pour chaque bien, enregistrer le lien iCal de chaque plateforme (Airbnb, Booking.com, Agoda, Trip.com, Vrbo…). Lecture automatique toutes les 10 minutes, plus un bouton « Synchroniser maintenant ».
- [x] Chaque événement importé crée ou met à jour une réservation (source = plateforme, `externalRef` = identifiant iCal). Un événement qui disparaît du fichier annule la réservation correspondante.
- [x] **Protection contre les doubles réservations** (alertes par `lib/notifications` : aucun fournisseur WhatsApp / e-mail choisi, le bandeau rouge et le tableau de bord font foi en attendant) :
  - détection immédiate des conflits (deux réservations sur les mêmes nuits), avec une alerte WhatsApp et e-mail à l'équipe et un bandeau rouge dans le back-office ;
  - délai de préparation et préavis minimum réglables par bien (par exemple pas de réservation le jour même), à reporter aussi dans les paramètres de chaque plateforme ;
  - alerte si un lien iCal ne répond plus ou n'a pas été lu depuis plus d'une heure (une synchronisation cassée ne prévient pas d'elle-même).
- [x] **Lecture des e-mails de réservation** (pour compenser les limites d'iCal) — **fournisseur de réception à choisir** (choix des associés, question du transfert loi 09-08) : l'adresse webhook par organisation est prête, et « Déposer un e-mail » (.eml ou collé) sert en attendant ; lecture FR/EN/ES d'Airbnb, Booking.com, Agoda, Trip.com, file « E-mails à traiter », messages chiffrés et effacés après 30 jours (lot 7b) : une adresse de réception propre à chaque organisation, vers laquelle sont transférés les e-mails de confirmation, de modification et d'annulation d'Airbnb, Booking.com, Agoda et Trip.com. L'application en extrait le code de réservation, le nom du voyageur, les dates, le nombre de voyageurs et le montant, bloque les dates **immédiatement** (sans attendre la lecture iCal) et complète la réservation. Les e-mails non reconnus vont dans une file à traiter à la main. Tests avec de vrais exemples d'e-mails anonymisés.
- [x] Journal de chaque synchronisation (heure, nombre d'événements, erreurs).
- [x] Les prix ne passent pas par iCal : afficher dans le back-office un rappel des prix à reporter sur chaque plateforme quand un prix change dans Sigma. (Synchronisation → Prix à reporter, un rappel par plateforme connectée, bouton « Fait », compteur au tableau de bord)
- [x] Guide pas à pas dans l'application pour connecter un bien à chaque plateforme (où trouver le lien d'import et d'export). (Biens → un bien → Plateformes ; formulations génériques « à vérifier sur l'interface actuelle de la plateforme », liste de vérification)
- [x] Tests : import, mise à jour, annulation, conflit, flux indisponible, fichier invalide, fuseau horaire.
- [ ] Plus tard (pas en V1) : demander l'accès aux API officielles d'Airbnb et de Booking.com, pour synchroniser en temps réel et transmettre les prix. Ces accès demandent une revue de sécurité et l'accord de chaque plateforme.

## Lot 8 — Messagerie et tableau de bord

- [ ] Boîte de réception unique : WhatsApp, e-mail, et les messages des plateformes qui arrivent par e-mail de notification. Les messages Airbnb et Booking.com en direct ne seront possibles qu'avec leurs API officielles (V3-8) : prévoir l'emplacement dans la couche `lib/channels/`.
- [ ] Messages automatiques avant, pendant et après le séjour, dans la langue du voyageur.
- [ ] Tableau de bord Sigma : occupation, revenu par nuit disponible, chiffre d'affaires par source, avis, alertes (autorisation 80-14 qui expire, panne ouverte, ménage en retard).

## Lot 9 — Expérience voyageur de niveau mondial

Référence : les meilleurs outils d'enregistrement en ligne et de messagerie (Chekin, Duve, Enso Connect, l'assistant IA de Guesty et Hospitable).

- [ ] **Enregistrement en ligne avant l'arrivée** : lien envoyé 3 jours avant, le voyageur remplit ses informations, photographie sa pièce d'identité, signe le règlement intérieur, indique son heure d'arrivée. Les données alimentent directement la déclaration DGSN (lot 5) et la taxe de séjour.
- [ ] **Assistant voyageurs par IA sur WhatsApp**, dans la langue du voyageur : répond aux questions à partir du guide d'accueil et de la fiche du logement, propose les services (voitures, excursions, transferts), crée une tâche pour l'équipe en cas de problème, et passe la main à un humain dès qu'il n'est pas sûr ou que le voyageur le demande. Toutes les réponses sont journalisées ; un mode « brouillon à valider » existe pour démarrer.
- [ ] **Ventes au bon moment** : propositions automatiques selon le moment du séjour (transfert à la réservation, excursions à l'arrivée, arrivée anticipée ou départ tardif selon le planning de ménage).
- [ ] **Demande d'avis** automatique après le départ, et brouillon de réponse aux avis proposé par l'IA, validé par l'équipe.
- [ ] Liste interne des voyageurs à problème, partagée seulement au sein de l'organisation, conforme à la loi 09-08.

## Lot 10 — Logement connecté

Référence : les intégrations de serrures connectées et de capteurs de bruit des grands logiciels (par exemple Minut sur Hostaway).

- [ ] **Serrures connectées** : couche d'adaptation pour plusieurs marques disponibles au Maroc (par exemple TTLock, Nuki, Igloohome — **me demander** avant de choisir la première). Un code unique par séjour, actif de l'heure d'arrivée à l'heure de départ, envoyé seulement après l'enregistrement en ligne ; codes séparés pour le ménage et la maintenance.
- [ ] **Capteurs de bruit et d'occupation** (sans enregistrement audio) : seuils réglables par logement, message automatique au voyageur en cas de bruit excessif, alerte à l'équipe si ça continue. Le voyageur en est informé dans l'annonce et le règlement intérieur.
- [ ] Alertes de batterie faible et d'appareil hors ligne.

## Lot 11 — Qualité et confiance des propriétaires

Référence : Breezeway pour les inspections, les portails propriétaires de Guesty et Hospitable, et la transparence de YourHostHelper.

- [ ] **Inspections avec photos de référence** : pour chaque pièce, la photo « comme il faut » ; l'agent compare et prend la sienne. Contrôle aléatoire par un associé.
- [ ] **Stocks et consommables** par logement (linge, produits d'accueil) avec alerte de réapprovisionnement.
- [ ] **Maintenance préventive** : calendrier par équipement (climatisation, chauffe-eau, piscine) avec rappels.
- [ ] **Score qualité par logement** : avis, problèmes signalés, délais de ménage ; alerte quand il baisse.
- [ ] **Certificat de conformité par logement**, visible par le propriétaire : autorisation 80-14, déclarations voyageurs à jour, taxes reversées, assurance.
- [ ] **Coffre-fort de documents** par propriétaire : mandat, autorisation, assurance, relevés.
- [ ] Validation par le propriétaire des dépenses au-dessus d'un montant qu'il fixe.
- [ ] Option « annonces et encaissements au nom du propriétaire » (le propriétaire garde son compte et ses avis s'il part).
- [ ] Résiliation du mandat de gestion par le propriétaire sans frais, depuis son portail ; s'il a choisi l'option « annonce à son nom », il garde son annonce et ses avis.
- [ ] Deux types de mandat paramétrables : gestion complète (commission par défaut 20 %) et gestion à distance où le propriétaire organise le ménage (commission par défaut 15 %).
- [ ] Relevés de gestion utilisables pour les transferts des propriétaires non résidents (Office des changes), au format validé avec la banque.

## Lot 12 — Gestion des revenus

Référence : PriceLabs et les outils de prix dynamique intégrés des grands logiciels.

- [ ] Prix de base, prix plancher fixé avec le propriétaire, prix plafond.
- [ ] Calendrier des événements de Marrakech et du Maroc (vacances françaises, espagnoles et belges, Ramadan et Aïd, festivals, matchs de la CAN et de la Coupe du monde 2030) avec ajustements.
- [ ] Ajustements selon le taux de remplissage, le délai avant l'arrivée et les nuits isolées entre deux réservations.
- [ ] Au départ : suggestions de prix à valider ; puis mode automatique par logement.
- [ ] Rapport mensuel par logement : revenu par nuit disponible comparé aux mois précédents.

## Lot 13 — Intelligence artificielle dans tout l'outil

- [ ] Rédaction et traduction des annonces (français, anglais, espagnol, arabe, puis chinois, coréen, japonais).
- [ ] Résumé quotidien pour les associés : arrivées, départs, problèmes, alertes, chiffres du jour.
- [ ] Transformation automatique d'un message voyageur en tâche (« la climatisation ne marche pas » → ticket de panne).
- [ ] Règle commune : l'IA propose, un humain valide pour tout ce qui engage de l'argent ou la réputation ; tout est journalisé ; aucune donnée d'identité envoyée à l'IA sans nécessité. Le fournisseur d'IA est un transfert de données hors du Maroc : voir « Avant la mise en ligne ».
- [ ] Coûts maîtrisés : quota de conversations IA et WhatsApp par organisation et par formule, suivi des coûts réels par organisation. WhatsApp facture désormais chaque message de modèle (hors fenêtre de 24 h) et le Maroc aura sa propre grille tarifaire à partir du 1er octobre 2026.

## Avant la mise en ligne

- [ ] Interface équipe et propriétaires en français, arabe (de droite à gauche) et anglais.
- [ ] Déclaration CNDP (loi 09-08) prête : liste des données personnelles traitées.
- [ ] **Transferts de données hors du Maroc** (loi 09-08, art. 43-44) : lister chaque service qui reçoit des données personnelles hors du Maroc (hébergeur, fournisseur d'IA, WhatsApp, e-mails, serrures) et obtenir l'autorisation de la CNDP, ou s'appuyer sur une exception prévue par la loi (consentement explicite, exécution du contrat). Le choix d'un hébergement au Maroc ou dans l'Union européenne simplifie ce point.
- [ ] Chiffrement des données sensibles (pièces d'identité, codes d'accès) au repos et en transit ; clés gérées hors de la base.
- [ ] Isolation des organisations renforcée au niveau de la base (sécurité au niveau des lignes PostgreSQL) en plus du filtre dans le code.
- [ ] Sauvegarde quotidienne de la base, et restauration testée (objectif : moins d'une heure).
- [ ] Surveillance 24 h/24 avec alertes (application, synchronisations, lecture des e-mails, serrures) et page d'état publique.
- [ ] Audit de sécurité externe avant d'ouvrir le logiciel à d'autres organisations.
- [ ] Performance : pages principales en moins de 2 secondes sur un téléphone en 4G ; accessibilité vérifiée.
- [ ] Documentation technique à jour (installation, architecture, procédures d'urgence), pour qu'un second développeur puisse reprendre le projet.
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

### V2-4 — Prix dynamique avancé
La gestion des revenus de base est dans le lot 12 (V1.2). La V2 ajoute :
- [ ] Données de marché externes (prix et remplissage des logements concurrents du quartier).
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
- [ ] Formules décidées (prix HT par logement actif et par mois, minimum 2 logements, −15 % en annuel) :
  - **Essentiel 99 DH** : calendrier central, synchronisation des plateformes, alertes e-mail, réservations manuelles et blocages, prix saisonniers, déclaration DGSN, taxe de séjour, suivi 80-14, guide d'accueil (marque Sigma), revenus par logement ; 2 utilisateurs ; support e-mail.
  - **Pro 179 DH** : Essentiel + alertes WhatsApp, messagerie unifiée, messages automatiques, conciergerie et marge, opérations terrain (tâches, check-lists, pannes), commissions, relevés PDF, portail propriétaire, export comptable, guide avec le logo du client ; 10 utilisateurs ; support WhatsApp.
  - **Business 279 DH** : Pro + prix dynamique, site de réservation directe avec paiement, portail partenaires, marque complète du client ; utilisateurs illimités ; support prioritaire 7 j/7.
  - **Syndic** (vendu à part) : 15 DH par lot et par mois, minimum 600 DH par résidence.
  - Ajouts issus de l'étude de marché : enregistrement en ligne, lecture des e-mails de réservation et certificat de conformité dans toutes les formules ; assistant IA WhatsApp (quota de conversations), serrures connectées, inspections et score qualité en Pro et Business ; capteurs de bruit et gestion des revenus automatique en Business.
  - Options : prix dynamique en Pro 49 DH/logement, utilisateur supplémentaire 49 DH, WhatsApp au-delà de 300 messages par logement et par an refacturé au coût + 20 %, mise en route 1 500 DH.
  - Remises : −10 % de 31 à 60 logements, −20 % au-delà ; offre fondateurs −30 % à vie pour les 20 premiers clients (cumulable seulement avec l'annuel). Mois d'essai gratuit en Pro, sans carte.
- [ ] Chaque fonction de l'application vérifie la formule de l'organisation (côté serveur), avec un message clair et un lien pour changer de formule quand elle n'est pas incluse. Les prix et le contenu des formules sont des paramètres modifiables par le SUPERADMIN, pas des valeurs codées en dur.
- [ ] **Résiliation instantanée** : bouton « Résilier » dans l'application, effet immédiat, sans préavis, sans frais, sans appel obligatoire, avec une seule question facultative sur la raison du départ.
  - Mensuel : plus aucun prélèvement dès la résiliation.
  - Annuel : remboursement automatique des mois entiers non utilisés, après recalcul des mois utilisés au tarif mensuel. Tests sur ce calcul.
  - Les liens de calendrier exportés restent actifs 30 jours en lecture seule, et l'application affiche la liste des liens à débrancher sur chaque plateforme (pas de double réservation à la sortie).
  - Export complet des données pendant 30 jours, puis suppression définitive ; réactivation en un clic pendant ces 30 jours, avec toutes les données.
- [ ] Un impayé ne coupe jamais la synchronisation des calendriers déjà en place (pour ne pas provoquer de doubles réservations chez le client) : relance à J+3 et J+10, lecture seule à J+15.
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

### V3-7 bis — Écosystème
- [ ] API publique et webhooks documentés, pour que les clients et partenaires branchent leurs outils.
- [ ] Import en un clic depuis un tableur ou un autre logiciel (pour attirer les réseaux de conciergeries).
- [ ] Place de marché de prestataires (ménage, maintenance, photographes) vérifiés, que les organisations clientes peuvent réserver depuis l'application.
- [ ] Vérifier avec Maroc PME si l'abonnement Sigma peut être financé pour les clients par le programme Go Siyaha (volet digitalisation).

### V3-8 — Connexion officielle aux plateformes
- [ ] Quand la plateforme compte assez de logements, demander l'accès aux API officielles d'Airbnb et de Booking.com (revue de sécurité, accord de chaque plateforme) pour une synchronisation en temps réel et le transfert des prix.
- [ ] Brancher ces API dans la couche d'adaptation `lib/channels/` du lot 7, sans changer le reste de l'application.
