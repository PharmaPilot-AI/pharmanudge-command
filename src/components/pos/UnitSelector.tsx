import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNaira } from "@/lib/money";
import type { PackagingUnit } from "@/lib/types";

interface UnitSelectorProps {
  units: PackagingUnit[];
  value: string;
  onChange: (unitId: string) => void;
  disabled?: boolean;
}

/**
 * Selling-unit selector (tablet / strip / tin…). The cart always converts
 * back to base units for stock impact.
 */
export function UnitSelector({ units, value, onChange, disabled }: UnitSelectorProps) {
  if (units.length <= 1) {
    return (
      <span className="inline-flex h-8 items-center rounded-md border bg-muted px-2.5 text-xs font-medium text-muted-foreground">
        {units[0]?.label ?? "Unit"}
      </span>
    );
  }
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled === true}>
      <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:w-44" aria-label="Selling unit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id} className="text-xs">
            {u.label} — {formatNaira(u.price)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
