# Generates the anonymized booking e-mail samples of tests/fixtures/email/ (Lot 7b). Every name, code, amount and
# listing is fictional; the wording is Sigma's own paraphrase of what such e-mails contain, not the platforms' text.
import base64, quopri, os, sys
OUT = sys.argv[1]

def qp(text, charset="utf-8"):
    return quopri.encodestring(text.encode(charset)).decode("ascii")

def b64(text, charset="utf-8"):
    raw = base64.b64encode(text.encode(charset)).decode("ascii")
    return "\r\n".join(raw[i:i+76] for i in range(0, len(raw), 76))

def ew(text, charset="utf-8", enc="B"):
    if enc == "B":
        return f"=?{charset}?B?{base64.b64encode(text.encode(charset)).decode()}?="
    q = quopri.encodestring(text.encode(charset), header=True).decode().replace("=\n", "")
    return f"=?{charset}?Q?{q}?="

def crlf(s):
    return s.replace("\r\n", "\n").replace("\n", "\r\n")

def write(name, content):
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(crlf(content).encode("latin-1") if isinstance(content, str) else content)

def alt(headers, text, html, text_cte="quoted-printable", html_cte="base64", charset="utf-8", boundary="sigma-alt-01"):
    enc = lambda body, cte: qp(body, charset) if cte == "quoted-printable" else b64(body, charset) if cte == "base64" else body.encode(charset).decode("latin-1")
    return (headers + f"MIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\n\n"
            f"--{boundary}\nContent-Type: text/plain; charset={charset}\nContent-Transfer-Encoding: {text_cte}\n\n{enc(text, text_cte)}\n"
            f"--{boundary}\nContent-Type: text/html; charset={charset}\nContent-Transfer-Encoding: {html_cte}\n\n{enc(html, html_cte)}\n"
            f"--{boundary}--\n")

def html_table(title, rows, extra=""):
    trs = "".join(f"<tr><td style=\"color:#555\">{k}</td><td><strong>{v}</strong></td></tr>" for k, v in rows)
    return f"<!DOCTYPE html><html><head><style>td{{padding:4px}}</style><title>{title}</title></head><body><h1>{title}</h1><table>{trs}</table>{extra}<p>Message automatique &ndash; ne pas r&eacute;pondre.</p></body></html>"

# ---------- Airbnb ----------

write("airbnb-confirmation-fr.eml", alt(
    "Return-Path: <automated@airbnb.com>\n"
    "Authentication-Results: mx.example.test; dkim=pass header.d=airbnb.com; spf=pass\n"
    "From: Airbnb <automated@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Réservation confirmée - Camille Testeur arrive le 12 juil.')}\n"
    "Date: Mon, 07 Jun 2027 10:15:00 +0000\n"
    "Message-ID: <fixture-airbnb-confirmation-fr@airbnb.example>\n",
    "Nouvelle réservation confirmée ! Camille Testeur arrive le 12 juil.\n\n"
    "Riad Test Jasmin\nhttps://www.airbnb.fr/rooms/40000001\n\n"
    "Arrivée\nlun. 12 juil. 2027\n15:00\n\n"
    "Départ\njeu. 15 juil. 2027\n11:00\n\n"
    "Voyageurs\n2 adultes, 1 enfant\n\n"
    "Code de confirmation\nHMTEST1234\n\n"
    "Le voyageur a payé\n3 nuits 4 980,00 MAD\nFrais de ménage 300,00 MAD\nTotal (MAD) 5 280,00 MAD\n\n"
    "Vous gagnez\n4 512,00 MAD\n\n"
    "Politique d'annulation : modérée.\n",
    html_table("Nouvelle réservation confirmée", [
        ("Logement", "Riad Test Jasmin"), ("Arrivée", "lun. 12 juil. 2027"), ("Départ", "jeu. 15 juil. 2027"),
        ("Voyageurs", "2 adultes, 1 enfant"), ("Code de confirmation", "HMTEST1234"), ("Vous gagnez", "4&nbsp;512,00&nbsp;MAD")],
        "<p><a href=\"https://www.airbnb.fr/rooms/40000001\">Voir l'annonce</a></p>")))

write("airbnb-confirmation-en.eml", alt(
    "From: Airbnb <automated@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: Reservation confirmed - Jordan Example arrives Aug 3\n"
    "Date: Sat, 10 Jul 2027 08:00:00 +0000\n"
    "Message-ID: <fixture-airbnb-confirmation-en@airbnb.example>\n",
    "New booking confirmed! Jordan Example arrives Aug 3.\n\n"
    "Listing\nDar Example Rose\nhttps://www.airbnb.com/rooms/40000002\n\n"
    "Check-in\nTue, Aug 3, 2027\n3:00 PM\n\n"
    "Checkout\nFri, Aug 6, 2027\n11:00 AM\n\n"
    "Guests\n2 adults\n\n"
    "Confirmation code\nHMTEST5678\n\n"
    "Guest paid\n€705.00\n\n"
    "You earn\n€612.40\n",
    html_table("New booking confirmed", [("Check-in", "Tue, Aug 3, 2027"), ("Checkout", "Fri, Aug 6, 2027"), ("Guests", "2 adults"), ("You earn", "&euro;612.40")]),
    text_cte="8bit"))

write("airbnb-modification-es.eml", alt(
    "From: Airbnb <express@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Se ha modificado la reservación HMTEST1234', 'utf-8', 'Q')}\n"
    "Date: Wed, 30 Jun 2027 18:20:00 +0000\n"
    "Message-ID: <fixture-airbnb-modification-es@airbnb.example>\n",
    "La reservación de Camille Testeur ha cambiado.\n\n"
    "Alojamiento\nRiad Test Jasmin\n\n"
    "Llegada\nmar., 13 de julio de 2027\n\n"
    "Salida\nsáb., 17 de julio de 2027\n\n"
    "Huéspedes\n2 adultos, 1 niño\n\n"
    "Código de confirmación\nHMTEST1234\n\n"
    "Ganas\n5 940,00 MAD\n",
    html_table("Reservación modificada", [("Llegada", "mar., 13 de julio de 2027"), ("Salida", "s&aacute;b., 17 de julio de 2027"), ("Ganas", "5&nbsp;940,00 MAD")])))

write("airbnb-cancellation-fr.eml",
    "From: Airbnb <automated@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Réservation HMTEST5678 annulée', 'utf-8', 'Q')}\n"
    "Date: Thu, 15 Jul 2027 09:00:00 +0000\n"
    "Message-ID: <fixture-airbnb-cancellation-fr@airbnb.example>\n"
    "MIME-Version: 1.0\n"
    "Content-Type: text/plain; charset=utf-8\n"
    "Content-Transfer-Encoding: quoted-printable\n\n"
    + qp("Jordan Example a annulé sa réservation HMTEST5678.\n\nLogement : Dar Example Rose\nArrivée : mar. 3 août 2027\nDépart : ven. 6 août 2027\n\nLes dates sont de nouveau disponibles sur l'annonce.\n"))

gmail_fwd_text = ("---------- Forwarded message ---------\n"
    "De : Airbnb <automated@airbnb.com>\n"
    "Date: lun. 7 juin 2027 à 12:15\n"
    "Subject: Réservation confirmée - Lina Démo arrive le 20 sept.\n"
    "To: <amine@sigma-test.example>\n\n"
    "Nouvelle réservation confirmée ! Lina Démo arrive le 20 sept.\n\n"
    "Riad Test Jasmin\n\n"
    "Arrivée\nlun. 20 sept.\n\n"
    "Départ\nven. 24 sept.\n\n"
    "Voyageurs\n4 voyageurs\n\n"
    "Code de confirmation\nHMFWDG0001\n\n"
    "Vous gagnez\n6 120,50 MAD\n")
write("airbnb-fwd-gmail-fr.eml", alt(
    "From: Amine Test <amine.test@gmail.example>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Fwd: Réservation confirmée - Lina Démo arrive le 20 sept.')}\n"
    "Date: Mon, 07 Jun 2027 10:40:00 +0000\n"
    "Message-ID: <fixture-airbnb-fwd-gmail@mail.gmail.example>\n",
    gmail_fwd_text,
    "<div dir=\"ltr\"><br><div class=\"gmail_quote\">" + gmail_fwd_text.replace("\n", "<br>") + "</div></div>"))

write("airbnb-message-en.eml",
    "From: Airbnb <automated@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: New message from Jordan Example\n"
    "Date: Sun, 11 Jul 2027 07:00:00 +0000\n"
    "Message-ID: <fixture-airbnb-message-en@airbnb.example>\n"
    "Content-Type: text/plain; charset=utf-8\n\n"
    "Jordan Example sent you a message about the reservation HMTEST5678:\n\n\"Hi! Can we drop our bags early?\"\n\nReply on the app.\n")

# ---------- Booking.com ----------

write("booking-confirmation-en.eml", alt(
    "From: Booking.com <noreply@booking.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: Booking.com - New booking! (4012345678, Sunday, 10 October 2027)\n"
    "Date: Fri, 20 Aug 2027 14:00:00 +0000\n"
    "Message-ID: <fixture-booking-confirmation-en@booking.example>\n",
    "You have a new booking.\n\n"
    "Property: Dar Exemple Menthe (ID 9900001)\n"
    "Booking number: 4012345678\n"
    "Guest name: Alex Placeholder\n"
    "Check-in: Sun 10 Oct 2027\n"
    "Check-out: Wed 13 Oct 2027\n"
    "Number of guests: 2\n"
    "Total price: € 480.00\n"
    "Commission: € 72.00\n",
    html_table("New booking", [("Property", "Dar Exemple Menthe (ID 9900001)"), ("Booking number", "4012345678"), ("Guest name", "Alex Placeholder"),
        ("Check-in", "Sun 10 Oct 2027"), ("Check-out", "Wed 13 Oct 2027"), ("Total price", "&euro; 480.00")]),
    text_cte="8bit"))

write("booking-confirmation-fr.eml", alt(
    "From: \"Booking.com\" <noreply@booking.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Nouvelle réservation ! (4012345679, vendredi 5 novembre 2027)', 'iso-8859-1', 'Q')}\n"
    "Date: Tue, 21 Sep 2027 09:30:00 +0200\n"
    "Message-ID: <fixture-booking-confirmation-fr@booking.example>\n",
    "Vous avez reçu une nouvelle réservation.\n\n"
    "Établissement : Dar Exemple Menthe\n"
    "Identifiant de l'établissement : 9900001\n"
    "Numéro de réservation : 4012345679\n"
    "Nom du client : Inès Exemple\n"
    "Arrivée : ven. 5 nov. 2027\n"
    "Départ : lun. 8 nov. 2027\n"
    "Nombre de personnes : 3 adultes\n"
    "Montant total : 3 450,00 MAD\n",
    html_table("Nouvelle r&eacute;servation", [("&Eacute;tablissement", "Dar Exemple Menthe"), ("Num&eacute;ro de r&eacute;servation", "4012345679"),
        ("Arriv&eacute;e", "ven. 5 nov. 2027"), ("D&eacute;part", "lun. 8 nov. 2027"), ("Montant total", "3&nbsp;450,00 MAD")]),
    charset="iso-8859-1"))

write("booking-modification-fr.eml",
    "From: Booking.com <noreply@booking.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Réservation modifiée (4012345679)', 'iso-8859-1', 'B')}\n"
    "Date: Sun, 03 Oct 2027 11:00:00 +0200\n"
    "Message-ID: <fixture-booking-modification-fr@booking.example>\n"
    "MIME-Version: 1.0\n"
    "Content-Type: text/plain; charset=ISO-8859-1\n"
    "Content-Transfer-Encoding: quoted-printable\n\n"
    + qp("Le client a modifié sa réservation.\n\nÉtablissement : Dar Exemple Menthe\nNuméro de réservation : 4012345679\nNom du client : Inès Exemple\nArrivée : sam. 6 nov. 2027\nDépart : mar. 9 nov. 2027\nNombre de personnes : 2 adultes, 1 enfant\nMontant total : 3 600,00 MAD\n", "iso-8859-1"))

write("booking-cancellation-es.eml",
    "From: Booking.com <noreply@booking.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: =?UTF-8?Q?Cancelaci=C3=B3n_de_reserva_=284012345678=29?=\n"
    "Date: Mon, 04 Oct 2027 16:45:00 +0000\n"
    "Message-ID: <fixture-booking-cancellation-es@booking.example>\n"
    "MIME-Version: 1.0\n"
    "Content-Type: text/html; charset=utf-8\n"
    "Content-Transfer-Encoding: base64\n\n"
    + b64(html_table("Reserva cancelada", [("Alojamiento", "Dar Exemple Menthe"), ("N&uacute;mero de reserva", "4012345678"), ("Nombre del cliente", "Alex Placeholder"),
        ("Entrada", "domingo, 10 de octubre de 2027"), ("Salida", "mi&eacute;rcoles, 13 de octubre de 2027")])) + "\n")

outlook_html = ("<html><body><div>Pour info, à traiter.</div><hr>"
    "<div id=\"divRplyFwdMsg\"><b>De :</b> Booking.com &lt;noreply@booking.com&gt;<br><b>Envoyé :</b> mardi 21 septembre 2027 09:30<br>"
    "<b>À :</b> Othman Test<br><b>Objet :</b> Nouvelle réservation ! (4012345680, samedi 11 décembre 2027)</div><br>"
    + html_table("Nouvelle r&eacute;servation", [("&Eacute;tablissement", "Dar Exemple Menthe (ID 9900001)"), ("Num&eacute;ro de r&eacute;servation", "4012345680"),
        ("Nom du client", "Noé Fictif"), ("Arriv&eacute;e", "sam. 11 déc. 2027"), ("D&eacute;part", "dim. 2 janv. 2028"),
        ("Nombre de personnes", "2"), ("Montant total", "12&nbsp;600,00&nbsp;MAD")]) + "</body></html>")
write("booking-fwd-outlook-fr.eml",
    "From: Othman Test <othman@outlook.example>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('TR: Nouvelle réservation ! (4012345680, samedi 11 décembre 2027)')}\n"
    "Date: Tue, 21 Sep 2027 08:00:00 +0000\n"
    "Message-ID: <fixture-booking-fwd-outlook@outlook.example>\n"
    "MIME-Version: 1.0\n"
    "Content-Type: multipart/related; boundary=\"rel-01\"\n\n"
    "--rel-01\nContent-Type: text/html; charset=\"utf-8\"\nContent-Transfer-Encoding: quoted-printable\n\n"
    + qp(outlook_html) + "\n--rel-01\nContent-Type: image/png; name=\"logo.png\"\nContent-Transfer-Encoding: base64\nContent-ID: <logo>\n\niVBORw0KGgo=\n--rel-01--\n")

attached = ("From: Booking.com <noreply@booking.com>\nTo: reservations@sigma-test.example\n"
    "Subject: Booking.com - Cancelled booking (4012345679)\nDate: Wed, 06 Oct 2027 10:00:00 +0000\n"
    "Message-ID: <fixture-booking-attached-cancel@booking.example>\nContent-Type: text/plain; charset=utf-8\n\n"
    "This booking has been cancelled by the guest.\n\nProperty: Dar Exemple Menthe\nBooking number: 4012345679\nGuest name: Ines Exemple\nCheck-in: Sat 6 Nov 2027\nCheck-out: Tue 9 Nov 2027\n")
write("booking-attached-cancellation-en.eml",
    "From: Felicia Test <felicia@outlook.example>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: FW: Booking.com - Cancelled booking (4012345679)\n"
    "Date: Wed, 06 Oct 2027 10:30:00 +0000\n"
    "Message-ID: <fixture-booking-attached@outlook.example>\n"
    "MIME-Version: 1.0\n"
    "Content-Type: multipart/mixed; boundary=\"mix-01\"\n\n"
    "--mix-01\nContent-Type: text/plain; charset=utf-8\n\nSee attached.\n"
    "--mix-01\nContent-Type: message/rfc822\nContent-Disposition: attachment; filename=\"cancel.eml\"\n\n"
    + attached + "\n--mix-01--\n")

# ---------- Agoda ----------

write("agoda-confirmation-en.eml", alt(
    "From: Agoda <no-reply@agoda.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: Agoda Booking ID 7012345678 - Confirmed\n"
    "Date: Mon, 30 Aug 2027 06:00:00 +0000\n"
    "Message-ID: <fixture-agoda-confirmation-en@agoda.example>\n",
    "Booking confirmation\n\n"
    "Booking ID: 7012345678\n"
    "Property: Riad Test Ambre\n"
    "Property ID: 880001\n"
    "Customer name: Sam Fictif\n"
    "Check-in date: October 21, 2027\n"
    "Check-out date: October 24, 2027\n"
    "Occupancy: 2 adults, 0 children\n"
    "Total price: USD 360.00\n"
    "Net rate to property: USD 300.00\n",
    html_table("Booking confirmation", [("Booking ID", "7012345678"), ("Check-in date", "October 21, 2027"), ("Check-out date", "October 24, 2027"), ("Net rate to property", "USD 300.00")])))

write("agoda-confirmation-es.eml",
    "From: Agoda <no-reply@agoda.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: =?utf-8?Q?Reserva_confirmada_-_ID_de_reserva_7012345679?=\n"
    "Date: Mon, 30 Aug 2027 07:00:00 +0000\n"
    "Message-ID: <fixture-agoda-confirmation-es@agoda.example>\n"
    "MIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n"
    + qp(html_table("Reserva confirmada", [("ID de reserva", "7012345679"), ("Propiedad", "Riad Test Ambre"), ("Nombre del cliente", "Lucía Prueba"),
        ("Fecha de llegada", "2 de noviembre de 2027"), ("Fecha de salida", "5 de noviembre de 2027"), ("Huéspedes", "2 adultos"), ("Tarifa neta", "270,00 EUR")])) + "\n")

write("agoda-cancellation-en.eml",
    "From: Agoda <no-reply@agoda.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: Cancellation - Booking ID 7012345678\n"
    "Date: Sun, 10 Oct 2027 06:00:00 +0000\n"
    "Message-ID: <fixture-agoda-cancellation-en@agoda.example>\n"
    "Content-Type: text/plain; charset=utf-8\n\n"
    "The booking below has been cancelled.\n\nBooking ID: 7012345678\nProperty: Riad Test Ambre\nCheck-in date: October 21, 2027\nCheck-out date: October 24, 2027\n")

# ---------- Trip.com ----------

write("tripcom-confirmation-en.eml",
    "From: Trip.com <hotel-noreply@trip.com>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: New Booking - Order No. 1290000000001\n"
    "Date: Wed, 01 Sep 2027 02:00:00 +0000\n"
    "Message-ID: <fixture-tripcom-confirmation-en@trip.example>\n"
    "MIME-Version: 1.0\nContent-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n"
    + b64(html_table("New booking", [("Order No.", "1290000000001"), ("Hotel name", "Dar Example Safran"), ("Guest Name", "DUPONT/TEST"),
        ("Check-in", "2027-11-02"), ("Check-out", "2027-11-05"), ("Guests", "2 adults"), ("Total amount", "EUR 390.00")])) + "\n")

write("tripcom-modification-fr.eml",
    "From: Trip.com <hotel-noreply@trip.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Commande modifiée - N° de commande 1290000000001')}\n"
    "Date: Fri, 15 Oct 2027 02:00:00 +0000\n"
    "Message-ID: <fixture-tripcom-modification-fr@trip.example>\n"
    "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n"
    "La commande ci-dessous a été modifiée.\n\nNuméro de commande : 1290000000001\nHôtel : Dar Example Safran\nNom du client : DUPONT/TEST\n"
    "Arrivée : 03/11/2027\nDépart : 06/11/2027\nNombre de voyageurs : 2\nMontant total : 1 450,00 MAD\n".encode("utf-8").decode("latin-1"))

# ---------- Tricky ----------

write("unknown-platform-fr.eml",
    "From: Plateforme Exemple <reservations@plateforme-exemple.test>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Nouvelle réservation n° PX-88231')}\n"
    "Date: Thu, 02 Sep 2027 12:00:00 +0000\n"
    "Message-ID: <fixture-unknown-platform@plateforme-exemple.test>\n"
    "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n"
    + qp("Bonjour,\n\nUne nouvelle réservation a été effectuée.\n\nRéférence : PX-88231\nArrivée : 14/12/2027\nDépart : 18/12/2027\nVoyageurs : 2\nMontant : 2 200,00 MAD\n"))

write("spam-en.eml",
    "From: Travel Deals <promo@deals-newsletter.test>\n"
    "To: reservations@sigma-test.example\n"
    "Subject: You won a free trip!!! Claim now\n"
    "Date: Thu, 02 Sep 2027 13:00:00 +0000\n"
    "Message-ID: <fixture-spam@deals-newsletter.test>\n"
    "Content-Type: text/html; charset=utf-8\n\n"
    "<html><body><h1>Congratulations!</h1><p>Click <a href=\"https://deals-newsletter.test/claim\">here</a> to claim your prize.</p></body></html>\n")

write("airbnb-dkim-fail-fr.eml",
    "Authentication-Results: mx.example.test; dkim=fail header.d=airbnb.com; dmarc=fail\n"
    "From: Airbnb <automated@airbnb.com>\n"
    "To: reservations@sigma-test.example\n"
    f"Subject: {ew('Réservation HMTEST1234 annulée', 'utf-8', 'Q')}\n"
    "Date: Thu, 01 Jul 2027 09:00:00 +0000\n"
    "Message-ID: <fixture-airbnb-dkim-fail@forged.example>\n"
    "Content-Type: text/plain; charset=utf-8\n\n"
    "Camille Testeur a annulé sa réservation HMTEST1234.\nArrivée : 12/07/2027\nDépart : 15/07/2027\n")
