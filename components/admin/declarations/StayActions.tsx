"use client";

import { Calculator, CheckCircle2, Lock, Undo2, Unlock } from "lucide-react";
import { useState, useTransition } from "react";
import { computeTaxAction, setDeclaredAction, setTaxClosedAction, type SimpleResult } from "@/app/admin/declarations/actions";
import { Button } from "@/components/ui/Button";

/** Small buttons of Déclarations and of a booking's page (ADMIN): declared or not, tax computed / closed / reopened. */

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SimpleResult>({});
  const run = (fn: () => Promise<SimpleResult>) => {
    setResult({});
    start(async () => setResult(await fn()));
  };
  return { pending, result, run };
}

function Result({ r }: { r: SimpleResult }) {
  if (r.error)
    return (
      <p role="alert" className="text-caption text-error">
        {r.error}
      </p>
    );
  if (r.message)
    return (
      <p role="status" className="text-caption font-medium text-brand-deep">
        {r.message}
      </p>
    );
  return null;
}

export function DeclareButton({ bookingId, declared }: { bookingId: string; declared: boolean }) {
  const { pending, result, run } = useRun();
  return (
    <div className="space-y-1" aria-live="polite">
      {declared ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Annuler la déclaration de ces voyageurs ?") && run(() => setDeclaredAction(bookingId, false))}>
          <Undo2 className="size-4" aria-hidden="true" />
          Annuler la déclaration
        </Button>
      ) : (
        <Button type="button" variant="primary" size="sm" disabled={pending} onClick={() => run(() => setDeclaredAction(bookingId, true))}>
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Marquer comme déclaré
        </Button>
      )}
      <Result r={result} />
    </div>
  );
}

export function TaxActions({ bookingId, computed, closed }: { bookingId: string; computed: boolean; closed: boolean }) {
  const { pending, result, run } = useRun();
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        {!closed && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => computeTaxAction(bookingId))}>
            <Calculator className="size-4" aria-hidden="true" />
            {computed ? "Recalculer" : "Calculer la taxe"}
          </Button>
        )}
        {closed ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Rouvrir la taxe de séjour de ce séjour ? Elle sera recalculée aux prochains changements.") && run(() => setTaxClosedAction(bookingId, false))}>
            <Unlock className="size-4" aria-hidden="true" />
            Rouvrir
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Clôturer la taxe de séjour ? Elle ne changera plus.") && run(() => setTaxClosedAction(bookingId, true))}>
            <Lock className="size-4" aria-hidden="true" />
            Clôturer
          </Button>
        )}
      </div>
      <Result r={result} />
    </div>
  );
}
