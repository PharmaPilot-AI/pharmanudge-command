/** Format database decimal strings without losing numeric precision. */
export function formatInventoryQuantity(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Invalid inventory quantity.");
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  const sign = negative && /[1-9]/.test(unsigned) ? "-" : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${grouped}${decimals ? `.${decimals}` : ""}`;
}

export function hasInventoryQuantity(value: string): boolean {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Invalid inventory quantity.");
  }
  return !value.startsWith("-") && /[1-9]/.test(value);
}

function moneyToKobo(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid inventory value.");
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}

/** SQL supplies purchase values rounded to two decimal places. */
export function sumInventoryValues(values: readonly (string | null)[]): string | null {
  let total = BigInt(0);
  for (const value of values) {
    if (value === null) return null;
    total += moneyToKobo(value);
  }

  const negative = total < BigInt(0);
  const absolute = negative ? -total : total;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(
    2,
    "0",
  )}`;
}

export function formatInventoryMoney(value: string | null): string {
  if (value === null) return "—";

  const kobo = moneyToKobo(value);
  const negative = kobo < BigInt(0);
  const absolute = negative ? -kobo : kobo;
  const whole = String(absolute / BigInt(100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(absolute % BigInt(100)).padStart(2, "0");
  return `${negative ? "-" : ""}₦${whole}.${fraction}`;
}

/** Date-only formatting stays identical during server and browser rendering. */
export function formatInventoryDate(value: string | null): string {
  if (value === null) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
