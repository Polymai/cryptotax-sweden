import { getAccessToken } from "../lib/supabaseClient.js";
import { getFunctionsBaseUrl } from "../lib/runtimeConfig.js";

export const EDGE_FUNCTION_ROUTER = "app687-cryptotax-sweden-api";

export const EDGE_FUNCTIONS = Object.freeze({
  connectBinance: "connect-binance",
  runDiscovery: "run-discovery",
  parseAccountStatement: "parse-account-statement",
  analyzeCsvImport: "analyze-csv-import",
  createCheckoutSession: "create-checkout-session",
  listBillingHistory: "list-billing-history",
  processOpeningBalance: "process-opening-balance",
  previewApiImport: "preview-api-import",
  importTaxYear: "import-tax-year",
  recoverCostBasis: "recover-cost-basis",
  generateTaxReport: "generate-tax-report",
  createBillingPortal: "create-billing-portal",
  createConnectOnboarding: "create-connect-onboarding",
});

const LEGACY_FUNCTION_ACTIONS = Object.freeze({
  "app687-cryptotax-sweden-connect-binance": "connect-binance",
  "app687-cryptotax-sweden-run-discovery": "run-discovery",
  "app687-cryptotax-sweden-parse-account-statement": "parse-account-statement",
  "app687-cryptotax-sweden-analyze-csv-import": "analyze-csv-import",
  "app687-cryptotax-sweden-create-checkout-session": "create-checkout-session",
  "app687-cryptotax-sweden-list-billing-history": "list-billing-history",
  "app687-cryptotax-sweden-process-opening-balance": "process-opening-balance",
  "app687-cryptotax-sweden-preview-api-import": "preview-api-import",
  "app687-cryptotax-sweden-import-tax-year": "import-tax-year",
  "app687-cryptotax-sweden-recover-cost-basis": "recover-cost-basis",
  "app687-cryptotax-sweden-generate-tax-report": "generate-tax-report",
  "app687-cryptotax-sweden-create-billing-portal": "create-billing-portal",
  "app687-cryptotax-sweden-create-connect-onboarding": "create-connect-onboarding",
});

function normalizeAction(functionName) {
  const raw = String(functionName || "").trim();
  if (!raw) return "";
  return LEGACY_FUNCTION_ACTIONS[raw] || raw;
}

export async function callEdgeFunction(functionName, payload = {}, options = {}) {
  const token = options.accessToken || (await getAccessToken());
  const action = normalizeAction(functionName);
  const routerName = options.routerName || EDGE_FUNCTION_ROUTER;
  const requestPayload = payload && typeof payload === "object" ? { ...payload, action } : { action };
  const url = `${getFunctionsBaseUrl().replace(/\/+$/, "")}/${routerName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(requestPayload),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { error: "The function returned a non-JSON response." };
  }
  if (!response.ok) {
    const message = body && (body.error || body.message) ? body.error || body.message : `Request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}
