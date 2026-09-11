export function currentUtcMonth(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return {
    startTime: Math.floor(start / 1000),
    period: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

export function summarizeCosts(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error("Invalid costs response");
  let amount = 0;
  let currency = "usd";
  for (const bucket of payload.data) {
    if (!Array.isArray(bucket?.results)) continue;
    for (const result of bucket.results) {
      const value = result?.amount?.value;
      const resultCurrency = result?.amount?.currency;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (typeof resultCurrency === "string" && resultCurrency) {
        if (amount && resultCurrency !== currency) throw new Error("Mixed cost currencies");
        currency = resultCurrency;
      }
      amount += value;
    }
  }
  return { amount, currency };
}
