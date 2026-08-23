import { Plus, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNaira } from "@/lib/money";
import type { ServiceItem } from "@/lib/types";

interface ServiceResultRowProps {
  service: ServiceItem;
  onAdd: (service: ServiceItem) => void;
}

/** Non-stock service in POS results — visually distinct from inventory items. */
export function ServiceResultRow({ service, onAdd }: ServiceResultRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-info/40 bg-info/5 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
        <Stethoscope className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-semibold">{service.name}</p>
          <span className="rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
            Service
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {service.description}
          {service.durationMinutes ? ` · ~${service.durationMinutes} min` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="text-sm font-semibold tabular-nums">{formatNaira(service.price)}</p>
        <Button size="sm" variant="outline" onClick={() => onAdd(service)} className="h-9 gap-1">
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>
    </div>
  );
}
