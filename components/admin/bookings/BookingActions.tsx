"use client";

import { useActionState } from "react";
import { cancelBookingAction, rescheduleBookingAction, type BookingActionState } from "@/app/admin/reservations/actions";
import { Button } from "@/components/ui/Button";
import type { BookingSource } from "@/lib/generated/prisma/enums";

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";

function Feedback({ state }: { state: BookingActionState }) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
        <p>{state.error}</p>
        {state.fieldErrors && (
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(state.fieldErrors).map(([k, m]) => (
              <li key={k}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
        {state.message}
      </p>
    );
  }
  return null;
}

/** New dates for the same listing (ADMIN). A direct booking is re-priced at its own nightly price. */
export function RescheduleForm({ bookingId, source, checkIn, checkOut }: { bookingId: string; source: BookingSource; checkIn: string; checkOut: string }) {
  const [state, action, pending] = useActionState(rescheduleBookingAction.bind(null, bookingId), {});
  return (
    <form action={action} noValidate className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Changer les dates</h2>
      <p className="text-ink-muted">
        {source === "DIRECT"
          ? "Le montant est recalculé avec le prix par nuit et le ménage de la réservation."
          : source === "OWNER"
            ? "Le blocage couvre les nouvelles dates à la place des anciennes."
            : "Le montant de la plateforme ne change pas ici : modifiez aussi la réservation sur la plateforme."}
      </p>
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Nouvelle arrivée</span>
          <input type="date" name="checkIn" required defaultValue={checkIn} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Nouveau départ</span>
          <input type="date" name="checkOut" required defaultValue={checkOut} className={input} />
        </label>
      </div>
      {source === "DIRECT" && (
        <label className="flex items-start gap-3">
          <input type="checkbox" name="allowShortStay" className="mt-1 size-4 accent-brand" />
          <span>Accepter un séjour plus court que le minimum du bien</span>
        </label>
      )}
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer les dates"}
      </Button>
    </form>
  );
}

/** Cancels the booking or lifts the owner block (ADMIN); the row is kept. */
export function CancelForm({ bookingId, source }: { bookingId: string; source: BookingSource }) {
  const [state, action, pending] = useActionState(cancelBookingAction.bind(null, bookingId), {});
  const owner = source === "OWNER";
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">{owner ? "Lever le blocage" : "Annuler la réservation"}</h2>
      <p className="text-ink-muted">
        {owner
          ? "Les dates redeviennent réservables."
          : source === "DIRECT"
            ? "Les dates redeviennent réservables. Prévenez le voyageur ; le remboursement éventuel se fait à part."
            : "Les dates redeviennent réservables dans Sigma. Annulez aussi la réservation sur la plateforme."}
      </p>
      <Feedback state={state} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="confirm" required className="mt-1 size-4 accent-brand" />
        <span>{owner ? "Je confirme la levée du blocage" : "Je confirme l'annulation"}</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending} className="border-error text-error hover:bg-[#fdecea]">
        {pending ? "Un instant…" : owner ? "Lever le blocage" : "Annuler la réservation"}
      </Button>
    </form>
  );
}
