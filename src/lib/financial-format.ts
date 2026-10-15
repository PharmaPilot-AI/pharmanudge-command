/** Format database decimal strings without floating-point conversion. */
export function financialMoney(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = "00"] = unsigned.split(".");
  return `${negative ? "-" : ""}₦${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function toKobo(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = "00"] = unsigned.split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return negative ? -result : result;
}

/** Percentage rounded to one decimal; undefined when total revenue is zero. */
export function financialPercent(part: string, total: string): string {
  const denominator = toKobo(total);
  if (denominator === BigInt(0)) return "—";
  const numerator = toKobo(part);
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  const tenths = (absolute * BigInt(1000) + denominator / BigInt(2)) / denominator;
  return `${negative ? "-" : ""}${tenths / BigInt(10)}.${tenths % BigInt(10)}%`;
}
