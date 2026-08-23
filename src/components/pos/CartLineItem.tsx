import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNaira, toBaseUnits } from "@/lib/money";
import type { ProductCartLine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UnitSelector } from "./UnitSelector";

interface CartLineItemProps {
  line: ProductCartLine;
  onQuantityChange: (quantity: number) => void;
  onUnitChange: (unitId: string) => void;
  onRemove: () => void;
}

/** Stock-product cart line with unit selection and live base-unit stock impact. */
export function CartLineItem({ line, onQuantityChange, onUnitChange, onRemove }: CartLineItemProps) {
  const { product, unit, quantity } = line;
  const maxQuantity = Math.floor(product.baseUnitsInStock / unit.baseUnitsPerUnit);
  const impactBase = toBaseUnits(quantity, unit);
  const remaining = product.baseUnitsInStock - impactBase;
  const exceeds = remaining < 0;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold leading-snug">{product.name}</p>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${product.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <UnitSelector
          units={product.units}
          value={unit.id}
          onChange={onUnitChange}
        />
        <div className="flex items-center rounded-md border">
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
        <p className="ml-auto text-sm font-bold tabular-nums">{formatNaira(unit.price * quantity)}</p>
      </div>

      <p
        className={cn(
          "mt-2 text-xs tabular-nums",
          exceeds ? "font-semibold text-destructive" : "text-muted-foreground",
        )}
      >
        Stock impact: -{impactBase.toLocaleString("en-US")} {product.baseUnitLabel}
        {impactBase === 1 ? "" : "s"} · Remaining after sale:{" "}
        {remaining.toLocaleString("en-US")} {product.baseUnitLabel}
        {remaining === 1 ? "" : "s"}
        {exceeds ? ` — only ${maxQuantity} × ${unit.label} available` : ""}
      </p>
    </div>
  );
}
