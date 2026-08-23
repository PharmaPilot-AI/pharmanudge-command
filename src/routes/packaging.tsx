import { createFileRoute } from "@tanstack/react-router";
import { FormEvent, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNaira } from "@/lib/money";
import { products } from "@/lib/mock-data";
import type { PackagingUnit } from "@/lib/types";

export const Route = createFileRoute("/packaging")({
  head: () => ({
    meta: [
      { title: "Product Packaging Setup — PharmaPilot AI" },
      { name: "description", content: "Define selling units per product — tablets, strips, tins — all converting to base units." },
      { property: "og:title", content: "Product Packaging Setup — PharmaPilot AI" },
      { property: "og:description", content: "Define selling units per product on the base-unit model." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PackagingPage,
});

let unitSeq = 100;

/**
 * Packaging setup: products are stocked in base units; packaging/selling
 * units are conversions on top (1 tin = 100 tablets).
 */
function PackagingPage() {
  const [productId, setProductId] = useState(products[0]!.id);
  const [extraUnits, setExtraUnits] = useState<Record<string, PackagingUnit[]>>({});
  const [label, setLabel] = useState("");
  const [perBase, setPerBase] = useState("");
  const [price, setPrice] = useState("");

  const product = useMemo(() => products.find((p) => p.id === productId)!, [productId]);
  const units = [...product.units, ...(extraUnits[productId] ?? [])];

  const addUnit = (e: FormEvent) => {
    e.preventDefault();
    const conv = Number.parseInt(perBase, 10);
    const value = Number.parseFloat(price);
    if (!label.trim()) {
      toast.error("Name the unit");
      return;
    }
    if (!Number.isFinite(conv) || conv < 1) {
      toast.error("Enter how many base units one unit contains");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    setExtraUnits((prev) => ({
      ...prev,
      [productId]: [
        ...(prev[productId] ?? []),
        { id: `u${++unitSeq}`, label: label.trim(), baseUnitsPerUnit: conv, price: value },
      ],
    }));
    setLabel("");
    setPerBase("");
    setPrice("");
    toast.success("Selling unit added locally (Phase 1 mock)");
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Product Packaging Setup"
        description="Sell in tablets, strips or tins — inventory always counts base units."
      />

      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm text-muted-foreground">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p>
          Base-unit model: {product.name} is stocked as{" "}
          <span className="font-medium text-foreground">{product.baseUnitLabel}s</span>. Selling
          units are conversions on top, so a sale of 1 tin always deducts exactly 100{" "}
          {product.baseUnitLabel}s.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pkg-product">Product</Label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger id="pkg-product" className="h-11 max-w-md"><SelectValue /></SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Selling units for {product.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{u.label}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  = {u.baseUnitsPerUnit} {product.baseUnitLabel}{u.baseUnitsPerUnit === 1 ? "" : "s"}
                </p>
              </div>
              <p className="font-semibold tabular-nums">{formatNaira(u.price)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Add a selling unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addUnit} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-label">Unit name</Label>
              <Input id="unit-label" placeholder="e.g. Sachet of 4" value={label} onChange={(e) => setLabel(e.target.value)} className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-per">= how many {product.baseUnitLabel}s?</Label>
              <Input id="unit-per" type="number" min={1} inputMode="numeric" placeholder="e.g. 4" value={perBase} onChange={(e) => setPerBase(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-price">Price (₦)</Label>
              <Input id="unit-price" type="number" min={0} inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <Button type="submit" className="h-11">Add unit</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
