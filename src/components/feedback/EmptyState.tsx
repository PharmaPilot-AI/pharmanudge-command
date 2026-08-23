import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string | undefined;
  actionLabel?: string | undefined;
  actionTo?: LinkProps["to"] | undefined;
}

/** Calm empty state used whenever a list or search has nothing to show. */
export function EmptyState({ icon: Icon, title, description, actionLabel, actionTo }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {actionLabel && actionTo ? (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to={actionTo}>{actionLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}
