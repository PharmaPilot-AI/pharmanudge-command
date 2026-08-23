import { Minus, Plus, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNaira } from "@/lib/money";
import type { ServiceCartLine } from "@/lib/types";

interface ServiceLineItemProps {
  line: ServiceCartLine;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}

/**
 * Service cart line — visually distinct from physical inventory and never
 * affects stock.
 */
export function ServiceLineItem({ line, onQuantityChange, onRemove }: ServiceLineItemProps) {
  const { service, quantity } = line;

  return (
    <div className="rounded-lg border border-dashed border-info/40 bg-info/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-info/10 text-info">
            <Stethoscope className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-snug">{service.name}</p>
            <p className="text-[11px] font-medium text-info">Service · no stock impact</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${service.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded-md border bg-card">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-r-none"
            onClick={() => onQuantityChange(quantity - 1)}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-8 text-center text-sm font-semibold tabular-nums">{quantity}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-l-none"
            onClick={() => onQuantityChange(quantity + 1)}
            aria-label="Increase quantity"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="ml-auto text-sm font-bold tabular-nums">{formatNaira(service.price * quantity)}</p>
      </div>
    </div>
  );
}
