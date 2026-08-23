import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Standard loading placeholder for data-driven screens. */
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/** Standard recoverable error state. */
export function ErrorState({
  title = "Something didn't load",
  message = "Please try again. If the problem continues, check your connection.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
