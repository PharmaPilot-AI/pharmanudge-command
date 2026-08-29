import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { FormEvent, useMemo, useState } from "react";
import { PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listProducts } from "@/lib/data/products";
import { createProductMutation } from "@/lib/data/validation";

const getProducts = createServerFn({ method: "GET" }).handler(() => listProducts());

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — PharmaPilot AI" },
      {
        name: "description",
        content: "Your full product catalog with packaging units and shelf locations.",
      },
      { property: "og:title", content: "Products — PharmaPilot AI" },
      { property: "og:description", content: "Full product catalog with shelf locations." },
      { property: "og:type", content: "website" },
    ],
  }),
  loader: () => getProducts(),
  component: ProductsPage,
});

const emptyProductForm = {
  name: "",
  genericName: "",
  category: "",
  barcode: "",
  baseUnitLabel: "",
  costPerBaseUnit: "",
  shelfLocation: "",
};

/** Product catalog browser. Editing arrives with Checkpoint 5. */
function ProductsPage() {
  const products = Route.useLoaderData();
  const router = useRouter();
  const createProduct = useServerFn(createProductMutation);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(emptyProductForm);

  const updateField =
    (field: keyof typeof emptyProductForm) => (e: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleAddProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.baseUnitLabel.trim()) {
      toast.error("Name and base unit are required");
      return;
    }
    setIsSubmitting(true);
    try {
      await createProduct({
        data: {
          name: form.name.trim(),
          base_unit_label: form.baseUnitLabel.trim(),
          ...(form.genericName.trim() ? { generic_name: form.genericName.trim() } : {}),
          ...(form.category.trim() ? { category: form.category.trim() } : {}),
          ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
          ...(form.shelfLocation.trim() ? { shelf_location: form.shelfLocation.trim() } : {}),
          ...(form.costPerBaseUnit.trim()
            ? { cost_per_base_unit: Number(form.costPerBaseUnit) }
            : {}),
        },
      });
      await router.invalidate();
      setForm(emptyProductForm);
      setIsAddOpen(false);
      toast.success("Product created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create product");
    } finally {
      setIsSubmitting(false);
    }
  };

  const results = useMemo(
    () =>
      products.filter((p) =>
        !q
          ? true
          : [p.name, p.generic_name, p.category, p.barcode ?? ""].some((f) =>
              f.toLowerCase().includes(q),
            ),
      ),
    [products, q],
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Products"
        description={`${products.length} products in the catalog.`}
        actions={
          <Button size="sm" className="gap-1" onClick={() => setIsAddOpen(true)}>
            <PackagePlus className="h-4 w-4" aria-hidden />
            Add product
          </Button>
        }
      />

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add product</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddProduct} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-name">Name</Label>
              <Input
                id="add-product-name"
                value={form.name}
                onChange={updateField("name")}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-generic">Generic name</Label>
              <Input
                id="add-product-generic"
                value={form.genericName}
                onChange={updateField("genericName")}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-category">Category</Label>
              <Input
                id="add-product-category"
                value={form.category}
                onChange={updateField("category")}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-barcode">Barcode</Label>
              <Input
                id="add-product-barcode"
                value={form.barcode}
                onChange={updateField("barcode")}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-base-unit">Base unit (e.g. tablet)</Label>
              <Input
                id="add-product-base-unit"
                value={form.baseUnitLabel}
                onChange={updateField("baseUnitLabel")}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-product-cost">Cost per base unit (₦)</Label>
              <Input
                id="add-product-cost"
                type="number"
                min={0}
                inputMode="decimal"
                value={form.costPerBaseUnit}
                onChange={updateField("costPerBaseUnit")}
                className="h-11 tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="add-product-shelf">Shelf location</Label>
              <Input
                id="add-product-shelf"
                value={form.shelfLocation}
                onChange={updateField("shelfLocation")}
                className="h-11"
              />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, generic, category or barcode…"
          className="h-11 pl-10"
          aria-label="Search products"
        />
      </div>

      {results.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No products found"
          description="Try a different search term."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {results.map((p) => (
            <div key={p.id} className="rounded-xl border bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.generic_name}</p>
                </div>
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                {p.shelf_location}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.category} · Barcode {p.barcode ?? "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
