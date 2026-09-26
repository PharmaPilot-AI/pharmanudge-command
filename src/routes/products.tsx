import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { FormEvent, useMemo, useState } from "react";
import { PackagePlus, Pencil, Search, Trash2 } from "lucide-react";
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
import {
  createProductMutation,
  deleteProductMutation,
  updateProductMutation,
} from "@/lib/data/validation";
import type { Tables } from "@/lib/supabase/database.types";

const getProducts = createServerFn({ method: "GET" }).handler(() => listProducts());

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — PharmaNudge" },
      {
        name: "description",
        content: "Your full product catalog with packaging units and shelf locations.",
      },
      { property: "og:title", content: "Products — PharmaNudge" },
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

/** Product catalog browser with create, edit, and delete. */
function ProductsPage() {
  const products = Route.useLoaderData();
  const { pharmacyContext } = Route.useRouteContext();
  const router = useRouter();
  const canManageCatalogue =
    pharmacyContext?.role === "owner" || pharmacyContext?.role === "pharmacist";
  const createProduct = useServerFn(createProductMutation);
  const updateProduct = useServerFn(updateProductMutation);
  const deleteProduct = useServerFn(deleteProductMutation);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Tables<"products"> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(emptyProductForm);

  const [deletingProduct, setDeletingProduct] = useState<Tables<"products"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateField =
    (field: keyof typeof emptyProductForm) => (e: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const openAddDialog = () => {
    setEditingProduct(null);
    setForm(emptyProductForm);
    setIsFormOpen(true);
  };

  const openEditDialog = (product: Tables<"products">) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      genericName: product.generic_name,
      category: product.category,
      barcode: product.barcode ?? "",
      baseUnitLabel: product.base_unit_label,
      costPerBaseUnit: product.cost_per_base_unit ? String(product.cost_per_base_unit) : "",
      shelfLocation: product.shelf_location,
    });
    setIsFormOpen(true);
  };

  const handleSubmitProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.baseUnitLabel.trim()) {
      toast.error("Name and base unit are required");
      return;
    }
    setIsSubmitting(true);
    try {
      const fields = {
        name: form.name.trim(),
        base_unit_label: form.baseUnitLabel.trim(),
        ...(form.genericName.trim() ? { generic_name: form.genericName.trim() } : {}),
        ...(form.category.trim() ? { category: form.category.trim() } : {}),
        ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
        ...(form.shelfLocation.trim() ? { shelf_location: form.shelfLocation.trim() } : {}),
        ...(form.costPerBaseUnit.trim()
          ? { cost_per_base_unit: Number(form.costPerBaseUnit) }
          : {}),
      };
      if (editingProduct) {
        await updateProduct({ data: { id: editingProduct.id, ...fields } });
      } else {
        await createProduct({ data: fields });
      }
      await router.invalidate();
      setForm(emptyProductForm);
      setIsFormOpen(false);
      setEditingProduct(null);
      toast.success(editingProduct ? "Product updated" : "Product created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${editingProduct ? "update" : "create"} product`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    setIsDeleting(true);
    try {
      await deleteProduct({ data: { id: deletingProduct.id } });
      await router.invalidate();
      setDeletingProduct(null);
      toast.success("Product deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete product");
    } finally {
      setIsDeleting(false);
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
          canManageCatalogue ? (
            <Button size="sm" className="gap-1" onClick={openAddDialog}>
              <PackagePlus className="h-4 w-4" aria-hidden />
              Add product
            </Button>
          ) : undefined
        }
      />

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingProduct(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit product" : "Add product"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitProduct} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                {isSubmitting
                  ? editingProduct
                    ? "Saving…"
                    : "Creating…"
                  : editingProduct
                    ? "Save changes"
                    : "Create product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingProduct !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingProduct(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingProduct?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this product and cannot be undone. Any packaging units
              defined for this product will also be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteProduct();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                {canManageCatalogue ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => openEditDialog(p)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setDeletingProduct(p)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
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
