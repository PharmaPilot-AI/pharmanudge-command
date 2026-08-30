import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { FormEvent, useState } from "react";
import { Pencil, Stethoscope, Trash2 } from "lucide-react";
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
import { formatNaira } from "@/lib/money";
import { listServices } from "@/lib/data/services";
import {
  createServiceMutation,
  deleteServiceMutation,
  updateServiceMutation,
} from "@/lib/data/validation";
import type { Tables } from "@/lib/supabase/database.types";

const getServices = createServerFn({ method: "GET" }).handler(() => listServices());

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Service Catalog — PharmaPilot AI" },
      {
        name: "description",
        content:
          "Non-stock services like consultations and tests. Services earn revenue without touching inventory.",
      },
      { property: "og:title", content: "Service Catalog — PharmaPilot AI" },
      {
        property: "og:description",
        content: "Non-stock services that earn revenue without touching inventory.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  loader: () => getServices(),
  component: ServicesPage,
});

/** Service catalog — services generate revenue but never reduce inventory. */
function ServicesPage() {
  const services = Route.useLoaderData();
  const router = useRouter();
  const createService = useServerFn(createServiceMutation);
  const updateService = useServerFn(updateServiceMutation);
  const deleteService = useServerFn(deleteServiceMutation);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingService, setEditingService] = useState<Tables<"services"> | null>(null);

  const [deletingService, setDeletingService] = useState<Tables<"services"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetForm = () => {
    setEditingService(null);
    setName("");
    setPrice("");
  };

  const openEditService = (service: Tables<"services">) => {
    setEditingService(service);
    setName(service.name);
    setPrice(String(service.price));
  };

  const handleSubmitService = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number.parseFloat(price);
    if (!name.trim()) {
      toast.error("Name the service");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingService) {
        await updateService({ data: { id: editingService.id, name: name.trim(), price: value } });
      } else {
        await createService({ data: { name: name.trim(), price: value } });
      }
      await router.invalidate();
      resetForm();
      toast.success(editingService ? "Service updated" : "Service created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${editingService ? "update" : "create"} service`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteService = async () => {
    if (!deletingService) return;
    setIsDeleting(true);
    try {
      await deleteService({ data: { id: deletingService.id } });
      await router.invalidate();
      setDeletingService(null);
      toast.success("Service deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete service");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Service Catalog"
        description="Consultations, tests and checks — revenue without stock impact."
      />

      <div className="flex flex-col gap-2.5">
        {services.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-dashed border-info/40 bg-info/5 p-3.5"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
              <Stethoscope className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.category}
                {s.duration_minutes ? ` · ~${s.duration_minutes} min` : ""} · available in POS
              </p>
            </div>
            <p className="shrink-0 text-sm font-bold tabular-nums">{formatNaira(s.price)}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={`Edit ${s.name}`}
                onClick={() => openEditService(s)}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={`Delete ${s.name}`}
                onClick={() => setDeletingService(s)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog
        open={deletingService !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingService(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingService?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this service and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteService();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {editingService ? `Edit ${editingService.name}` : "Add a service"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmitService}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-name">Service name</Label>
              <Input
                id="svc-name"
                placeholder="e.g. Typhoid test (Widal)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-price">Price (₦)</Label>
              <Input
                id="svc-price"
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
                  ? editingService
                    ? "Saving…"
                    : "Adding…"
                  : editingService
                    ? "Save changes"
                    : "Add service"}
              </Button>
              {editingService ? (
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
    </div>
  );
}
