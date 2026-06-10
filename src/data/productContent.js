export const taxYears = [2026, 2025, 2024, 2023, 2022];

export const planCatalog = [
  {
    key: "free",
    name: "Free",
    description: "Preview and import very small Binance workspaces.",
    priceAmount: 0,
    currency: "sek",
    maxTransactions: 50,
    includesAiRecovery: false,
    badge: "0-50 transactions",
  },
  {
    key: "starter",
    name: "Starter",
    description: "Small accounts with yearly reports and K4-ready rows.",
    priceAmount: 4900,
    currency: "sek",
    maxTransactions: 250,
    includesAiRecovery: false,
    badge: "Up to 250 transactions",
  },
  {
    key: "lite",
    name: "Lite",
    description: "Typical small Binance workspaces with API import.",
    priceAmount: 9900,
    currency: "sek",
    maxTransactions: 750,
    includesAiRecovery: false,
    badge: "Up to 750 transactions",
  },
  {
    key: "standard",
    name: "Standard",
    description: "Multi-year workspaces with AI-assisted recovery notes.",
    priceAmount: 19900,
    currency: "sek",
    maxTransactions: 2500,
    includesAiRecovery: true,
    badge: "Up to 2,500 transactions",
  },
  {
    key: "plus",
    name: "Plus",
    description: "Larger Binance workspaces with deeper audit trail.",
    priceAmount: 39900,
    currency: "sek",
    maxTransactions: 7500,
    includesAiRecovery: true,
    badge: "Up to 7,500 transactions",
  },
  {
    key: "pro",
    name: "Pro",
    description: "High-volume accounts up to the self-service limit.",
    priceAmount: 49900,
    currency: "sek",
    maxTransactions: 10000,
    includesAiRecovery: true,
    badge: "Up to 10,000 transactions",
  },
];

export const workflowSteps = [
  {
    key: "connect",
    title: "Connect Binance",
    detail: "Validate your Binance Tax API key and discover which activity endpoints matter.",
  },
  {
    key: "csv",
    title: "CSV import",
    detail: "Upload other exchange or wallet CSV files and approve the mapped rows.",
  },
  {
    key: "import",
    title: "Review transactions",
    detail: "Review imported rows, SEK values, source, and cost basis flags.",
  },
  {
    key: "report",
    title: "Generate report",
    detail: "Create K4 rows, income summary, tax estimate, and an audit explanation.",
  },
];

export const reportSections = [
  "K4 disposals grouped by asset and disposal event",
  "Other income summary for rewards, earn, referrals, and bonuses",
  "SEK valuation trail with cached market and FX rates",
  "Cost basis recovery memo for missing acquisition history",
];
