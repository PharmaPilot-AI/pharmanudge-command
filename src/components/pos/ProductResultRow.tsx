import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { baseStockLabel, formatNaira, productStockStatus } from "@/lib/money";
import type { Product } from "@/lib/types";

interface ProductResultRowProps {
  product: Product;
  onAdd: (product: Product) => void;
}

/** One product in POS search results. Base-unit price is the "from" price. */
export function ProductResultRow({ product, onAdd }: ProductResultRowProps) {
  const status = productStockStatus(product);
  const out = status === "out";
  const baseUnit = product.units[0]!;

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-semibold">{product.name}</p>
          {status === "low" && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
              Low stock
            </span>
          )}
          {out && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
              Out of stock
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {product.genericName} · {product.category}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {baseStockLabel(product)} available · {product.shelfLocation}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="text-sm font-semibold tabular-nums">
          {formatNaira(baseUnit.price)}
          <span className="text-xs font-normal text-muted-foreground"> / {baseUnit.label.toLowerCase()}</span>
        </p>
        <Button size="sm" disabled={out} onClick={() => onAdd(product)} className="h-9 gap-1">
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>
    </div>
  );
}
