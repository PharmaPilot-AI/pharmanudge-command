import "@tanstack/react-start/server-only";
import { CATALOGUE_PAGE_SIZE, loadCatalogueRows } from "./catalogue-pages";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { saleSchema, type SaleInput } from "./sale-schema";

async function resolvePosContext() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to use the POS.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (!["owner", "pharmacist", "cashier"].includes(context.role)) {
    throw new Error("Only an active owner, pharmacist or cashier can use the POS.");
  }
  return { client, context };
}

/** Pharmacy-scoped selling catalogue. Purchase costs are never returned. */
export async function getPosCatalogue() {
  const { client, context } = await resolvePosContext();

  const [productRows, unitRows, serviceRows, inventoryRows] = await Promise.all([
    loadCatalogueRows(
      (afterId) => {
        let query = client
          .from("products")
          .select("id, name, generic_name, category, barcode, base_unit_label, shelf_location")
          .eq("pharmacy_id", context.pharmacyId)
          .eq("is_active", true)
          .order("id").limit(CATALOGUE_PAGE_SIZE);
        if (afterId !== null) query = query.gt("id", afterId);
        return query;
      },
      (row) => row.id,
    ),
    loadCatalogueRows(
      (afterId) => {
        let query = client
          .from("packaging_units")
          .select(
          "id, product_id, label, base_units_per_unit, price, products!inner(pharmacy_id, is_active)",
          )
          .eq("is_active", true)
          .eq("products.pharmacy_id", context.pharmacyId)
          .eq("products.is_active", true)
          .order("id").limit(CATALOGUE_PAGE_SIZE);
        if (afterId !== null) query = query.gt("id", afterId);
        return query;
      },
      (row) => row.id,
    ),
    loadCatalogueRows(
      (afterId) => {
        let query = client
          .from("services")
          .select("id, name, price")
          .eq("pharmacy_id", context.pharmacyId)
          .eq("is_active", true)
          .order("id").limit(CATALOGUE_PAGE_SIZE);
        if (afterId !== null) query = query.gt("id", afterId);
        return query;
      },
      (row) => row.id,
    ),
    loadCatalogueRows(
      (afterId) => {
        let query = client.rpc("list_pharmacy_inventory", {
          target_pharmacy_id: context.pharmacyId,
          }).order("product_id").limit(CATALOGUE_PAGE_SIZE);
        if (afterId !== null) query = query.gt("product_id", afterId);
        return query;
      },
      (row) => row.product_id,
    ),
  ]);

  productRows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  serviceRows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  unitRows.sort((a, b) => a.base_units_per_unit - b.base_units_per_unit || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const available = new Map(
    inventoryRows.map((row) => [row.product_id, row.available_quantity]),
  );

  const units = unitRows.map((unit) => ({
    id: unit.id,
    product_id: unit.product_id,
    label: unit.label,
    base_units_per_unit: unit.base_units_per_unit,
    price: unit.price,
  }));

  const products = productRows.map((product) => {
    const quantity = available.get(product.id);
    if (quantity === undefined) {
      throw new Error("Inventory changed while loading the catalogue. Please refresh.");
    }
    return {
      ...product,
      available_quantity: quantity,
      units: units.filter((unit) => unit.product_id === product.id),
    };
  });

  return { products, services: serviceRows };
}

/** The database verifies catalogue prices and deducts stock atomically. */
export async function confirmPharmacySale(
  input: SaleInput,
): Promise<{ status: "confirmed"; saleId: string } | { status: "rejected"; message: string }> {
  const sale = saleSchema.parse(input);
  const { client, context } = await resolvePosContext();

  const { data, error } = await client.rpc("confirm_pharmacy_sale", {
    target_pharmacy_id: context.pharmacyId,
    operation_id: sale.operation_id,
    sale_payment_method: sale.payment_method,
    sale_lines: sale.lines,
  });

  if (error) {
    const expectedMessages = [
      "This business day is closed. New sales cannot be recorded.",
      "A selling price has changed. Refresh the catalogue and review the sale.",
      "This submission reference was already used for a different sale.",
      "An active product was not found in this pharmacy.",
      "An active selling unit was not found for this product.",
      "An active service was not found in this pharmacy.",
      "Sale quantity or expected price is invalid.",
      "Sale line exceeds the supported amount or quantity.",
      "Sale total exceeds the supported amount.",
    ];

    if (
      error.code === "22023" &&
      (expectedMessages.includes(error.message) ||
        (error.message.startsWith("Insufficient unexpired stock for ") &&
          error.message.endsWith(". Review quantities and refresh inventory.")))
    ) {
      if (error.message === "This submission reference was already used for a different sale.") {
        throw new Error("Submission reference conflict. Ask the owner to review this sale.");
      }
      return { status: "rejected", message: error.message };
    }

    if (error.code === "42501") {
      throw new Error("An active owner, pharmacist or cashier membership is required.");
    }

    throw new Error("Unable to confirm the sale. Retry the same submission.");
  }

  if (!data) throw new Error("Sale confirmation did not return a result.");
  return { status: "confirmed", saleId: data };
}
