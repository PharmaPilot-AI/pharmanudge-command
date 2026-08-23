import { Wifi } from "lucide-react";

/**
 * Connectivity/synchronization indicator. Phase 1 always shows the healthy
 * state; it becomes meaningful when offline POS lands later.
 */
export function SyncStatusPill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
      <Wifi className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Online · Synced</span>
      <span className="sm:hidden">Synced</span>
    </span>
  );
}
