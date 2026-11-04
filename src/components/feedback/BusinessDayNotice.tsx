import { Button } from "@/components/ui/button";

type DayStatus = {
  kind: "checking" | "open" | "closed" | "error";
  business_date?: string | undefined;
};

/** Presentation only: database guards remain authoritative for every write. */
export function BusinessDayNotice({
  status,
  onRefresh,
}: {
  status: DayStatus;
  onRefresh: () => void;
}) {
  if (status.kind === "open") return null;
  return (
    <div
      role={status.kind === "error" ? "alert" : "status"}
      className="rounded-xl border border-warning p-4 text-sm"
    >
      <p className="font-semibold">
        {status.kind === "closed"
          ? `Business day closed — ${status.business_date} · Lagos time`
          : status.kind === "error"
            ? "Business day status unavailable"
            : "Checking the Lagos business day…"}
      </p>
      <p className="mt-1">
        {status.kind === "closed"
          ? "New sales and expenses cannot be recorded for this closed business day. A new Lagos day becomes available after its status is verified."
          : "New sales and expenses are paused until the current business day can be verified."}
      </p>
      <p className="mt-1">
        Saved submissions can still be retried using their original reference to confirm their
        outcome.
      </p>
      <Button variant="outline" className="mt-3" onClick={onRefresh}>
        Refresh day status
      </Button>
    </div>
  );
}
