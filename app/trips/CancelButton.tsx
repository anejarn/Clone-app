"use client";

import { useState, useTransition } from "react";
import { cancelTrip } from "./actions";

export function CancelButton({ bookingId }: { bookingId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Annuler cette réservation ?")) return;
          start(async () => setError((await cancelTrip(bookingId)).error ?? null));
        }}
        className="font-semibold underline underline-offset-2 disabled:opacity-50"
      >
        {pending ? "Annulation…" : "Annuler la réservation"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-error">
          {error}
        </p>
      )}
    </div>
  );
}
