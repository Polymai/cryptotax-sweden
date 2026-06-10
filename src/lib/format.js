const sekFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("sv-SE", {
  maximumFractionDigits: 8,
});

const percentFormatter = new Intl.NumberFormat("sv-SE", {
  style: "percent",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatSek(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return sekFormatter.format(amount);
}

export function formatMinorSek(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) / 100 : 0;
  return sekFormatter.format(amount);
}

export function formatQuantity(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return numberFormatter.format(amount);
}

export function formatPercent(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return percentFormatter.format(amount);
}

export function formatConfidence(value) {
  return formatPercent(value || 0);
}

export function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return dateFormatter.format(date);
}
