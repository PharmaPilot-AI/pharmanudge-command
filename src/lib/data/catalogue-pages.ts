export const CATALOGUE_PAGE_SIZE = 200;
const MAX_CATALOGUE_ROWS = 100_000;

/** Keyset pagination avoids offset shifts and continues even under a lower server row cap.
 * Callers must order/filter by the same unique UUID key and keep tenant filters on every page.
 * Separate requests are not a database snapshot; writes still validate current stock/prices.
 */
export async function loadCatalogueRows<T>(
  page: (afterId: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>,
  rowId: (row: T) => string,
): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | null = null;
  while (true) {
    const result = await page(afterId);
    if (result.error || !Array.isArray(result.data)) {
      throw new Error("Unable to load the complete catalogue. Please refresh and try again.");
    }
    if (result.data.length === 0) return rows;
    if (
      result.data.length > CATALOGUE_PAGE_SIZE ||
      rows.length + result.data.length > MAX_CATALOGUE_ROWS
    ) {
      throw new Error("The catalogue exceeds the supported loading limit.");
    }
    for (const row of result.data) {
      const id = rowId(row);
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ||
        (afterId !== null && id <= afterId)
      ) {
        throw new Error("The catalogue returned inconsistent ordering. Please refresh.");
      }
      rows.push(row);
      afterId = id;
    }
  }
}
