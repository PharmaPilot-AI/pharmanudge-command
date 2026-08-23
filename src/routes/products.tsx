import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baseStockLabel, productStockStatus, stockStatusLabel } from "@/lib/money";
import { products } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — PharmaPilot AI" },
      { name: "description", content: "Your full product catalog with stock status, packaging units and shelf locations." },
      { property: "og:title", content: "Products — PharmaPilot AI" },
      { property: "og:description", content: "Full product catalog with stock status and packaging units." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ProductsPage,
});

const statusBadgeClasses: Record<string, string> = {
  out: "bg-destructive/10 text-destructive",
  low: "bg-warning/10 text-warning",
  ok: "bg-success/10 text-success",
};

/** Product catalog browser. Editing arrives with the Phase 2 backend. */
function ProductsPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const results = useMemo(
    () =>
      products.filter((p) =>
        !q
          ? true
          : [p.name, p.genericName, p.category, p.barcode].some((f) => f.toLowerCase().includes(q)),
      ),
    [q],
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Products"
        description={`${products.length} products in the catalog.`}
        actions={
          <Button size="sm" className="gap-1" onClick={() => toast.info("Product creation arrives with the Phase 2 backend")}>
            <PackagePlus className="h-4 w-4" aria-hidden />
            Add product
          </Button>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, generic, category or barcode…"
          className="h-11 pl-10"
          aria-label="Search products"
        />
      </div>

      {results.length === 0 ? (
        <EmptyState icon={Search} title="No products found" description="Try a different search term." />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {results.map((p) => {
            const status = productStockStatus(p);
            return (
              <div key={p.id} className="rounded-xl border bg-card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.genericName}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClasses[status])}>
                    {stockStatusLabel(status)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                  {baseStockLabel(p)} · {p.units.length} selling unit{p.units.length === 1 ? "" : "s"} · {p.shelfLocation}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.category} · Barcode {p.barcode}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
