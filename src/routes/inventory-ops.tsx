import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { pharmacyInventoryQuery } from "@/lib/data/validation";
import {
  formatInventoryQuantity,
  formatInventoryMoney,
  formatInventoryDate,
  hasInventoryQuantity,
} from "@/lib/inventory-format";

export const Route = createFileRoute("/inventory-ops")({
  loader: () => pharmacyInventoryQuery(),
  head: () => ({
    meta: [
      { title: "Inventory Operations — PharmaNudge" },
      {
        name: "description",
        content: "Current pharmacy stock quantities, shelves, batches and expiry dates.",
      },
    ],
  }),
  component: InventoryOps,
});

function InventoryOps() {
  const inventory = Route.useLoaderData();
  const { pharmacyContext } = Route.useRouteContext();
  const [search, setSearch] = useState("");
  const role = pharmacyContext?.role;
  const canReceive = role === "owner" || role === "pharmacist";
  const canViewValues = role === "owner" || role === "accountant";
  const query = search.trim().toLowerCase();
  const rows = inventory.filter((row) =>
    [row.product_name, row.generic_name, row.category, row.shelf_location].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
  const asOfDate = inventory[0]?.as_of_date;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inventory"
        description="Available stock, expiry quantities and shelf locations."
        actions={
          canReceive ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/receive-stock">Receive stock</Link>
            </Button>
          ) : undefined
        }
      />

      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search product, generic name, category or shelf"
        aria-label="Search inventory"
        className="max-w-lg"
      />
      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of {inventory.length} products.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          {inventory.length === 0
            ? "No products in this pharmacy yet."
            : "No products match your search."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Shelf</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Expiring ≤ 30 days</TableHead>
                  <TableHead>Batches · nearest expiry</TableHead>
                  {canViewValues && <TableHead className="text-right">Purchase value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.product_id}>
                    <TableCell>
                      <p className="font-medium">{row.product_name}</p>
                      <p className="text-xs text-muted-foreground">{row.generic_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Base unit: {row.base_unit_label}
                      </p>
                      {!row.is_active && <Badge variant="outline">Inactive product</Badge>}
                      {row.is_active && !hasInventoryQuantity(row.available_quantity) && (
                        <Badge variant="outline">Out of stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>{row.shelf_location || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInventoryQuantity(row.on_hand_quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInventoryQuantity(row.available_quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInventoryQuantity(row.expired_quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInventoryQuantity(row.expiring_quantity)}
                    </TableCell>
                    <TableCell>
                      {row.batch_count} · {formatInventoryDate(row.nearest_expiry)}
                    </TableCell>
                    {canViewValues && (
                      <TableCell className="text-right tabular-nums">
                        {formatInventoryMoney(row.stock_value)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2.5 md:hidden">
            {rows.map((row) => (
              <div key={row.product_id} className="rounded-xl border bg-card p-3.5">
                <p className="break-words text-sm font-semibold">{row.product_name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.generic_name} · Shelf: {row.shelf_location || "Not assigned"}
                </p>
                {!row.is_active && <Badge variant="outline">Inactive product</Badge>}
                {row.is_active && !hasInventoryQuantity(row.available_quantity) && (
                  <Badge variant="outline">Out of stock</Badge>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">On hand</dt>
                    <dd>
                      {formatInventoryQuantity(row.on_hand_quantity)} {row.base_unit_label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Available</dt>
                    <dd>
                      {formatInventoryQuantity(row.available_quantity)} {row.base_unit_label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Expired</dt>
                    <dd>
                      {formatInventoryQuantity(row.expired_quantity)} {row.base_unit_label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Expiring ≤ 30 days</dt>
                    <dd>
                      {formatInventoryQuantity(row.expiring_quantity)} {row.base_unit_label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Batches</dt>
                    <dd>{row.batch_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Nearest expiry</dt>
                    <dd>{formatInventoryDate(row.nearest_expiry)}</dd>
                  </div>
                  {canViewValues && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Purchase value</dt>
                      <dd>{formatInventoryMoney(row.stock_value)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Quantities are shown in base units. Available stock excludes stock expiring today or
        earlier. Nearest expiry includes expired batches that still hold stock.
        {asOfDate ? ` Expiry assessed as of ${formatInventoryDate(asOfDate)} in Lagos.` : ""}
      </p>
    </div>
  );
}
