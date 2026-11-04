import { useEffect, useMemo, useReducer } from "react";
import { pharmacyBusinessDayQuery } from "@/lib/data/validation";
import { BusinessDayGate, BUSINESS_DAY_POLL_MS } from "./business-day-gate";

/**
 * Advisory live gate; the database remains authoritative for closure races.
 * Call canSubmit before persisting/dispatching a NEW request. Saved exact
 * retries deliberately bypass this preflight for idempotent reconciliation.
 */
export function useBusinessDay(pharmacyId: string | undefined, userId: string | undefined) {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const gate = useMemo(
    () =>
      new BusinessDayGate(pharmacyId, userId, {
        read: (signal) => pharmacyBusinessDayQuery({ signal }),
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      }),
    [pharmacyId, userId],
  );

  useEffect(() => {
    gate.activate();
    const unsubscribe = gate.subscribe(rerender);
    const refresh = () => {
      void gate.refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Also wake at Lagos midnight, so yesterday's closed notice is not kept
      // until the next poll. Snapshot/preflight checks remain safe when asleep.
      const lagosMs = Date.now() + 3_600_000;
      const untilMidnight = 86_400_000 - (((lagosMs % 86_400_000) + 86_400_000) % 86_400_000);
      timer = setTimeout(
        () => {
          refresh();
          schedule();
        },
        Math.min(BUSINESS_DAY_POLL_MS, untilMidnight),
      );
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    schedule();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
      unsubscribe();
      gate.dispose();
    };
  }, [gate]);

  return {
    status: gate.status,
    blocked: gate.blocked,
    canSubmit: gate.canSubmit,
    refresh: gate.refresh,
    markClosed: gate.markClosed,
  };
}
