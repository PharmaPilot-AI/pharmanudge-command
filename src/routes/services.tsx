import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { FormEvent, useState } from "react";
import { Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNaira } from "@/lib/money";
import { listServices } from "@/lib/data/services";
import type { Tables } from "@/lib/supabase/database.types";

const getServices = createServerFn({ method: "GET" }).handler(() => listServices());

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Service Catalog — PharmaPilot AI" },
      { name: "description", content: "Non-stock services like consultations and tests. Services earn revenue without touching inventory." },
      { property: "og:title", content: "Service Catalog — PharmaPilot AI" },
      { property: "og:description", content: "Non-stock services that earn revenue without touching inventory." },
      { property: "og:type", content: "website" },
    ],
  }),
  loader: () => getServices(),
  component: ServicesPage,
});

let serviceSeq = 100;

/** Service catalog — services generate revenue but never reduce inventory. */
function ServicesPage() {
  const initialServices = Route.useLoaderData();
  const [services, setServices] = useState<Tables<"services">[]>(initialServices);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const addService = (e: FormEvent) => {
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
    const now = new Date().toISOString();
    setServices((prev) => [
      ...prev,
      {
        id: `s${++serviceSeq}`,
        pharmacy_id: "",
        name: name.trim(),
        description: "Custom service",
        price: value,
        category: "Custom",
        duration_minutes: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);
    setName("");
    setPrice("");
    toast.success("Service added locally (Phase 1 mock)");
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Service Catalog"
        description="Consultations, tests and checks — revenue without stock impact."
      />

      <div className="flex flex-col gap-2.5">
        {services.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-dashed border-info/40 bg-info/5 p-3.5">
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
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Add a service</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addService} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-name">Service name</Label>
              <Input id="svc-name" placeholder="e.g. Typhoid test (Widal)" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-price">Price (₦)</Label>
              <Input id="svc-price" type="number" min={0} inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <Button type="submit" className="h-11">Add service</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
