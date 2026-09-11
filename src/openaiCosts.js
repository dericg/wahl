export function formatOpenAICost(amount, currency = "usd") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "unavailable";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
