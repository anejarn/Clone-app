# Sigma — Application de gestion locative et conciergerie (Marrakech)

## Contexte
Sigma est une SARL marocaine (Marrakech) fondée par Amine, Felicia et Othman.
Trois métiers dans une seule application :
1. Gestion locative courte durée (biens de propriétaires, sous-location, biens des associés)
2. Conciergerie voyageurs (location de voitures et activités via partenaires, transferts, ménage, chef, hammam)
3. Syndic de copropriété (phase V2)

Positionnement : service haut de gamme, meilleur rapport qualité-prix. Commission propriétaire ~20 %, marge sur les services voyageurs.

## Règles pour Claude Code
- Le résultat de /replica-recon sert d'INSPIRATION fonctionnelle uniquement : ne jamais copier le code, les textes, les logos, les images ni la marque de l'app analysée. Toute l'identité est celle de Sigma.
- Construire par étapes : V1 d'abord (usage interne dès janvier 2027), V2 ensuite. Ne pas commencer la V2 tant que la V1 n'est pas testée.
- Pas de channel manager payant : l'application Sigma est elle-même le calendrier central. Elle synchronise les disponibilités avec Airbnb, Booking.com, Agoda, Trip.com, etc. par iCal (import et export), avec les protections du lot 7 contre les doubles réservations. Tout passe par une couche d'adaptation (`lib/channels/`) pour pouvoir brancher plus tard les API officielles des plateformes.
- Toujours écrire des tests pour les calculs financiers (commissions, relevés propriétaires, taxe de séjour).
- Me demander avant tout choix irréversible (base de données, hébergeur, fournisseur de paiement).

## Point de départ : le clone Airbnb (replica-recon)
Le projet part d'un clone fonctionnel d'Airbnb. Sigma n'est PAS une place de marché ouverte à tous les hôtes : c'est une seule société qui gère ses biens. Le clone doit être transformé ainsi :

À GARDER et adapter (devient le « front voyageur » Sigma) :
- Fiche logement (photos, équipements, carte, règles)
- Recherche et filtres (limités aux biens Sigma)
- Calendrier de disponibilité et prix
- Tunnel de réservation directe
- Compte voyageur, messagerie, avis

À TRANSFORMER :
- « Hôte » → équipe Sigma (rôle associé/admin) qui gère tous les biens
- Disponibilités → calendrier central Sigma, synchronisé avec les plateformes (lot 7) ; prix gérés dans Sigma
- Après réservation → guide d'accueil numérique + catalogue de services (voitures, activités, transferts)

À SUPPRIMER :
- Inscription publique des hôtes et mise en ligne libre d'annonces
- Modèle de commission de place de marché entre hôtes et voyageurs
- Toute référence visuelle ou textuelle à Airbnb (nom, logo, couleurs, textes, illustrations)

À AJOUTER (absent du clone) : back-office Sigma (opérations terrain, déclaration voyageurs, finances, relevés propriétaires, tableau de bord), portail propriétaire, conciergerie, puis syndic en V2.

## Stack souhaitée (à confirmer par /replica-architect)
- Application web responsive installable sur téléphone (PWA), mode hors ligne simple pour les agents terrain
- Backend avec base de données relationnelle, sauvegarde quotidienne
- Authentification avec rôles et double authentification pour l'équipe
- Notifications WhatsApp et e-mail

## Rôles utilisateurs
associé (admin) · agent terrain · propriétaire · voyageur · partenaire (V2) · copropriétaire (V2) · super-administrateur de la plateforme (V3)
Chacun ne voit que ses propres données, et uniquement celles de son organisation.

## Modules V1 (indispensables)
1. Biens : fiche par bien (adresse, photos, équipements, codes d'accès, inventaire), statut et date d'expiration de l'autorisation loi 80-14
2. Réservations : calendrier unifié multi-biens synchronisé avec les plateformes par iCal, réservations directes, blocage de dates propriétaire
3. Prix : prix par saison et événement, séjour minimum (prix dynamique en V2)
4. Messagerie : boîte unique (WhatsApp, e-mail, notifications des plateformes reçues par e-mail ; messages Airbnb et Booking en direct seulement avec leurs API officielles), messages automatiques avant/pendant/après séjour, traduction
5. Déclaration voyageurs : saisie des pièces d'identité au check-in, export pour la télé-déclaration DGSN, calcul de la taxe de séjour
6. Opérations terrain : tâches générées par réservation (ménage, linge, accueil), affectation, check-lists avec photos, tickets de panne
7. Conciergerie : catalogue voitures, activités, transferts, chef, hammam ; demande depuis le guide d'accueil ; transmission au partenaire ; suivi de la marge
8. Guide d'accueil numérique : page web par réservation (accès, Wi-Fi, règles, recommandations, boutons de services) ; codes d'accès visibles seulement pendant le séjour
9. Finances : revenus par bien, commission Sigma, dépenses refacturées, relevé mensuel PDF par propriétaire, export comptable, journal de toutes les opérations
10. Portail propriétaire (lecture) : tableau de bord en temps réel, relevés, documents
11. Tableau de bord Sigma : occupation, revenu par nuit disponible, CA par source, avis, alertes

12. Lecture des e-mails de réservation des plateformes (blocage immédiat des dates, montants, noms des voyageurs)
13. Expérience voyageur : enregistrement en ligne avant l'arrivée, assistant IA sur WhatsApp avec relais humain, ventes au bon moment, demandes d'avis
14. Logement connecté : serrures avec un code par séjour, capteurs de bruit sans enregistrement audio
15. Qualité et confiance : inspections avec photos de référence, stocks, maintenance préventive, score qualité, certificat de conformité par logement, coffre-fort de documents, mandat « gestion à distance » à 15 %
16. Gestion des revenus : prix plancher et plafond, événements locaux, ajustements selon le remplissage, suggestions puis automatisation

## Ambition : n°1 à Marrakech puis au Maroc
- Référence de qualité : les meilleurs logiciels mondiaux (Guesty, Hostaway, Hospitable, Breezeway, Chekin, PriceLabs, Minut), adaptés au Maroc.
- Ce qui doit nous distinguer : conformité marocaine complète et prouvée (80-14, DGSN, taxe de séjour, Office des changes), conciergerie voyageurs intégrée, syndic, arabe et dirhams, meilleur prix du marché marocain.
- Fiabilité avant tout : surveillance 24 h/24, sauvegardes testées, audit de sécurité, documentation pour un second développeur.
- Détail dans `TACHES_SIGMA.md` (lots 9 à 13 et « Avant la mise en ligne »).

## Modules V2
- Paiement en ligne des services (passerelle CMI + lien de paiement international — à valider avec la banque)
- Portail partenaires (loueurs de voitures, guides)
- Syndic : copropriétés, lots, tantièmes, appels de charges, recouvrement, factures scannées, budget, tickets parties communes, convocation et vote électronique des AG (loi 18-00 modifiée par 106-12 et 30-24)
- Services résidents : maintenance privative, livraison de gaz, ménage à domicile, suivi à distance pour les MRE
- Site de réservation directe Sigma
- Prix dynamique

## V3 — Sigma logiciel pour d'autres gestionnaires
D'autres conciergeries et propriétaires pourront s'abonner à l'application pour gérer leurs propres biens. Conséquences dès la V1 :
- Toutes les données appartiennent à une organisation (`organizationId`) ; Sigma est la première. Aucune donnée ne doit pouvoir passer d'une organisation à une autre, et chaque route est testée pour ça.
- Ce qui est propre à Sigma (commission, partenaires, catalogue, marque) est un paramètre de l'organisation, pas une valeur codée en dur.
- Le détail des lots V3 est dans `TACHES_SIGMA.md`.

## Langues
- Équipe et propriétaires : français, arabe (droite à gauche dès le départ), anglais
- Voyageurs V1 : français, espagnol, anglais ; ensuite néerlandais, allemand, italien, arabe ; puis chinois simplifié, coréen, japonais (clientèle Agoda / Trip.com)

## Conformité
- Données personnelles : loi 09-08 (déclaration CNDP avant mise en service) + principes RGPD pour les voyageurs européens
- Pièces d'identité : stockage chiffré, accès restreint, suppression après le délai légal
- Le code, la marque, le domaine et les données appartiennent à la SARL Sigma

## Monnaie et formats
Dirham marocain (MAD) par défaut, euro en affichage secondaire. Dates au format JJ/MM/AAAA.
