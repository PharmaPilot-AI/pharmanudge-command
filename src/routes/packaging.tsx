import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Layers, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { listProducts } from "@/lib/data/products";
import { listPackagingUnitsForProduct } from "@/lib/data/packaging-units";
import {
  createPackagingUnitMutation,
  deletePackagingUnitMutation,
  updatePackagingUnitMutation,
} from "@/lib/data/validation";
import type { Tables } from "@/lib/supabase/database.types";

const getProducts = createServerFn({ method: "GET" }).handler(() => listProducts());

const getPackagingUnits = createServerFn({ method: "GET" })
  .validator((productId: string) => productId)
  .handler(({ data: productId }) => listPackagingUnitsForProduct(productId));

export const Route = createFileRoute("/packaging")({
  head: () => ({
    meta: [
      { title: "Product Packaging Setup — PharmaNudge" },
      {
        name: "description",
        content:
          "Define selling units per product — tablets, strips, tins — all converting to base units.",
      },
      { property: "og:title", content: "Product Packaging Setup — PharmaNudge" },
      {
        property: "og:description",
        content: "Define selling units per product on the base-unit model.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  loader: () => getProducts(),
  component: PackagingPage,
});

/**
 * Packaging setup: products are stocked in base units; packaging/selling
 * units are conversions on top (1 tin = 100 tablets).
 */
function PackagingPage() {
  const products = Route.useLoaderData();
  const { pharmacyContext } = Route.useRouteContext();
  const canManageCatalogue =
    pharmacyContext?.role === "owner" || pharmacyContext?.role === "pharmacist";
  const getPackagingUnitsFn = useServerFn(getPackagingUnits);
  const createPackagingUnit = useServerFn(createPackagingUnitMutation);
  const updatePackagingUnit = useServerFn(updatePackagingUnitMutation);
  const deletePackagingUnit = useServerFn(deletePackagingUnitMutation);

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [units, setUnits] = useState<Tables<"packaging_units">[]>([]);
  const [isLoadingUnits, setIsLoadingUnits] = useState(true);
  const [label, setLabel] = useState("");
  const [perBase, setPerBase] = useState("");
  const [price, setPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Tables<"packaging_units"> | null>(null);

  const [deletingUnit, setDeletingUnit] = useState<Tables<"packaging_units"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);

  // Switching products invalidates any in-progress edit/delete for a unit
  // that belongs to the previously-selected product.
  useEffect(() => {
    setEditingUnit(null);
    setDeletingUnit(null);
    setLabel("");
    setPerBase("");
    setPrice("");
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setIsLoadingUnits(true);
    getPackagingUnitsFn({ data: productId })
      .then((data) => {
        if (!cancelled) setUnits(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingUnits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, getPackagingUnitsFn]);

  /** Re-fetches this product's packaging units from their actual data
   * source (a per-product server call, not the route loader). */
  const refreshUnits = async () => {
    setIsLoadingUnits(true);
    try {
      const data = await getPackagingUnitsFn({ data: productId });
      setUnits(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load packaging units");
    } finally {
      setIsLoadingUnits(false);
    }
  };

  const resetForm = () => {
    setEditingUnit(null);
    setLabel("");
    setPerBase("");
    setPrice("");
  };

  const openEditUnit = (unit: Tables<"packaging_units">) => {
    setEditingUnit(unit);
    setLabel(unit.label);
    setPerBase(String(unit.base_units_per_unit));
    setPrice(String(unit.price));
  };

  const handleSubmitUnit = async (e: FormEvent) => {
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
    setIsSubmitting(true);
    try {
      if (editingUnit) {
        await updatePackagingUnit({
          data: {
            id: editingUnit.id,
            label: label.trim(),
            base_units_per_unit: conv,
            price: value,
          },
        });
      } else {
        await createPackagingUnit({
          data: {
            product_id: productId,
            label: label.trim(),
            base_units_per_unit: conv,
            price: value,
          },
        });
      }
      await refreshUnits();
      resetForm();
      toast.success(editingUnit ? "Selling unit updated" : "Selling unit created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${editingUnit ? "update" : "create"} selling unit`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUnit = async () => {
    if (!deletingUnit) return;
    setIsDeleting(true);
    try {
      await deletePackagingUnit({ data: { id: deletingUnit.id } });
      await refreshUnits();
      setDeletingUnit(null);
      toast.success("Selling unit deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete selling unit");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!product) {
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <PageHeader
          title="Product Packaging Setup"
          description="Sell in tablets, strips or tins — inventory always counts base units."
        />
        <p className="text-sm text-muted-foreground">No products found for this pharmacy yet.</p>
      </div>
    );
  }

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
          <span className="font-medium text-foreground">{product.base_unit_label}s</span>. Selling
          units are conversions on top, so a sale of 1 tin always deducts exactly 100{" "}
          {product.base_unit_label}s.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pkg-product">Product</Label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger id="pkg-product" className="h-11 max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Selling units for {product.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isLoadingUnits ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            units.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-lg border bg-background p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{u.label}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    = {u.base_units_per_unit} {product.base_unit_label}
                    {u.base_units_per_unit === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatNaira(u.price)}</p>
                {canManageCatalogue ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Edit ${u.label}`}
                      onClick={() => openEditUnit(u)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label={`Delete ${u.label}`}
                      onClick={() => setDeletingUnit(u)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deletingUnit !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingUnit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingUnit?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this selling unit and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteUnit();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canManageCatalogue ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              {editingUnit ? `Edit ${editingUnit.label}` : "Add a selling unit"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmitUnit}
              className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unit-label">Unit name</Label>
                <Input
                  id="unit-label"
                  placeholder="e.g. Sachet of 4"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unit-per">= how many {product.base_unit_label}s?</Label>
                <Input
                  id="unit-per"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="e.g. 4"
                  value={perBase}
                  onChange={(e) => setPerBase(e.target.value)}
                  className="h-11 tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unit-price">Price (₦)</Label>
                <Input
                  id="unit-price"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-11 tabular-nums"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="h-11" disabled={isSubmitting}>
                  {isSubmitting
                    ? editingUnit
                      ? "Saving…"
                      : "Creating…"
                    : editingUnit
                      ? "Save changes"
                      : "Add unit"}
                </Button>
                {editingUnit ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={resetForm}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
