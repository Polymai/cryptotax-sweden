import { appStorage } from "./lib/appStorage.js";
import { copyText } from "./lib/clipboard.js";
import { formatConfidence, formatDate, formatMinorSek, formatQuantity, formatSek } from "./lib/format.js";
import { getStripeConfig } from "./lib/runtimeConfig.js";
import { getSupabaseClient } from "./lib/supabaseClient.js";
import { EDGE_FUNCTIONS, callEdgeFunction } from "./api/functions.js";
import {
  getLatestAuditEventForTaxYear,
  getLatestReportForTaxYear,
  getTaxYearByYear,
  listBinanceConnections,
  listImportJobs,
  listOpeningBalances,
  listTransactions,
} from "./api/db.js";
import {
  completeAppProfile,
  getAuthSnapshot,
  initAuthState,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeAuth,
} from "./state/authState.js";
import { planCatalog, reportSections, taxYears, workflowSteps } from "./data/productContent.js";

const root = document.getElementById("app");
const storedTransactions = sanitizeStoredTransactions(appStorage.getSession("transactions", []));
const storedOpeningBalances = sanitizeStoredOpeningBalances(appStorage.getSession("openingBalances", []));
const storedDiscovery = sanitizeStoredDiscovery(appStorage.getSession("discovery", null));
const storedStatementDraft = appStorage.getSession("statementDraft", null);
const storedImportPreview = sanitizeImportPreview(appStorage.getSession("importPreview", null));
const initialTheme = normalizeTheme(appStorage.getLocal("theme", getPreferredTheme()));
const checkoutReturnStatus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("checkout") : "";
const storedRoute = appStorage.getLocal("route", "dashboard");
const storedPlanKey = appStorage.getLocal("selectedPlan", "free");
const initialPlanKey = planCatalog.some((plan) => plan.key === storedPlanKey) ? storedPlanKey : "free";
const PASSWORD_MIN_LENGTH = 6;
const UPLOAD_BUCKET = ["app687", "cryptotax", "uploads"].join("_");
const SELF_SERVICE_TRANSACTION_LIMIT = 10000;
const DISCOVERY_PRODUCT_META = Object.freeze({
  spot: { label: "Spot wallet", group: "wallet" },
  spot_trades: { label: "Spot trades", group: "trades" },
  simple_earn_flexible: { label: "Simple Earn flexible", group: "earn" },
  simple_earn_locked: { label: "Simple Earn locked", group: "earn" },
  staking: { label: "Staking", group: "earn" },
  asset_dividends: { label: "Interest, rewards, dividends", group: "income" },
  convert: { label: "Convert history", group: "activity" },
  deposits: { label: "Deposits", group: "transfers" },
  withdrawals: { label: "Withdrawals", group: "transfers" },
  margin: { label: "Margin account", group: "margin" },
  usdm_futures: { label: "USD-M futures", group: "futures" },
  usdm_futures_income: { label: "USD-M futures income", group: "futures" },
  coinm_futures: { label: "COIN-M futures", group: "futures" },
  coinm_futures_income: { label: "COIN-M futures income", group: "futures" },
});

const state = {
  route: checkoutReturnStatus ? "billing" : storedRoute === "import" || storedRoute === "statement" ? "binance" : storedRoute,
  mobileOpen: false,
  theme: initialTheme,
  selectedPlan: initialPlanKey,
  selectedTaxYear: appStorage.getLocal("selectedTaxYear", 2025),
  transactions: storedTransactions,
  connection: appStorage.getSession("connection", { status: "not_connected", label: "No Binance connection" }),
  discovery: storedDiscovery,
  importPreview: storedImportPreview,
  openingBalances: storedOpeningBalances,
  statementDraft: storedStatementDraft,
  report: appStorage.getSession("report", null),
  aiImport: appStorage.getSession("aiImport", null),
  billingHistory: { loading: false, loaded: false, payments: [], invoices: [], error: "" },
  auth: getAuthSnapshot(),
  notice: checkoutReturnStatus === "success" ? "Checkout completed. Refreshing billing history and invoices." : "",
  error: "",
  loading: false,
  loadingText: "",
  authMode: "signin",
  editingConnection: false,
  transactionCategoryFilter: "all",
  transactionTypeFilter: "all",
  transactionAssetFilter: "all",
  transactionVisibleCount: 100,
  reportIncomeVisibleCount: 100,
  selectedTransactionIds: [],
  excludedTransactionIds: appStorage.getSession("excludedTransactionIds", []),
};

applyTheme(state.theme);

const icons = {
  dashboard: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z" fill="currentColor"/></svg>`,
  import: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 7 8h3v6h4V8h3l-5-5Zm-7 13v4h14v-4h-2v2H7v-2H5Z" fill="currentColor"/></svg>`,
  binance: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v4H5V4Zm0 6h6v10H5V10Zm8 0h6v10h-6V10Zm-6 2v2h2v-2H7Zm8 0v2h2v-2h-2Zm-8 4v2h2v-2H7Zm8 0v2h2v-2h-2Z" fill="currentColor"/></svg>`,
  statement: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6V3Zm8 1.8V7h2.2L14 4.8ZM8 10h8v2H8v-2Zm0 4h8v2H8v-2Zm0 4h5v1.5H8V18Z" fill="currentColor"/></svg>`,
  transactions: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v3H4V5Zm0 5h16v3H4v-3Zm0 5h16v4H4v-4Zm2 1.5v1h3v-1H6Zm0-5v1h5v-1H6Zm0-5v1h7v-1H6Z" fill="currentColor"/></svg>`,
  aiImport: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 2.2L17.6 8 12 10.8 6.4 8 12 5.2ZM6 9.7l5 2.5v6.1l-5-2.5V9.7Zm7 8.6v-6.1l5-2.5v6.1l-5 2.5Z" fill="currentColor"/></svg>`,
  report: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6V3Zm8 1.8V7h2.2L14 4.8ZM8 10h8v2H8v-2Zm0 4h8v2H8v-2Zm0 4h5v1.5H8V18Z" fill="currentColor"/></svg>`,
  billing: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16v12H4V6Zm2 3h12V8H6v1Zm0 4h5v3H6v-3Zm7 0h5v1.5h-5V13Z" fill="currentColor"/></svg>`,
  account: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z" fill="currentColor"/></svg>`,
  menu: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" fill="currentColor"/></svg>`,
};

const uiText = {
  en: {
    dashboard: "Dashboard",
    binance: "Binance",
    csvImport: "CSV Import",
    transactions: "Transactions",
    reports: "Reports",
    billing: "Billing",
    account: "Account",
    signIn: "Sign in",
    signedIn: "Signed in",
    secureSignIn: "Secure Supabase sign-in for saved workspaces",
    taxYear: "Tax year",
    readyForDiscovery: "Ready for discovery",
    ready: "Ready",
    connectBinance: "Connect Binance Tax API key to start",
    taxableResult: "Estimated taxable result from current ledger",
    language: "Language",
    displayName: "Display name",
    active: "Active",
    signedInAs: "Signed in as",
    supabaseUser: "Supabase user",
    useUsdPeg: "Use USD peg for stablecoin cost basis",
    useUsdPegHelp: "USDT, USDC, FDUSD and DAI use transaction-date USD/SEK as fallback when purchase history is missing.",
    calculationSettings: "Tax calculation settings",
    calculationSettingsHelp: "Defaults used when the app prices and recovers imported transactions.",
    saveProfile: "Save profile",
    profileTrust: "Sign-in is handled securely by Supabase. If you have used another service from the same provider, the same account may work here.",
    signOut: "Sign out",
    uploadedSlotsTitle: "Uploaded transactions / purchased transaction slots",
    inYear: "in",
    generated: "Generated",
    draft: "Draft",
    rows: "rows",
    reportGenerated: "Report generated.",
    k4Report: "K4 report",
    k4ReportHelp: "Generate a K4 section D transfer sheet for Skatteverket and keep income rows separate.",
    k4SectionRows: "K4 section D rows",
    k4Profit: "K4 profit",
    k4Loss: "K4 loss",
    otherIncome: "Other income",
    generateReport: "Generate report",
    saveK4Pdf: "Save K4 PDF",
    downloadK4Csv: "Download K4 CSV",
    auditExplanation: "Audit explanation",
    auditExplanationHelp: "Copy this into your own review notes or accountant handoff.",
    digitalFilingNote: "Digital filing note",
    digitalFilingHelp: "Skatteverket's digital file transfer uses SRU files. This PDF/CSV is a K4 section D review and entry underlag, not an SRU upload file.",
    skatteverketGuideTitle: "Where to enter this at Skatteverket",
    skatteverketGuideHelp: "In Skatteverket's e-service Inkomstdeklaration 1, add appendix K4 and use section D for crypto and other assets.",
    skatteverketGuideStep1: "Open Inkomstdeklaration 1 and go to attachments.",
    skatteverketGuideStep2: "Choose K4 - Other securities, other assets, etc.",
    skatteverketGuideStep3: "Use section D for crypto disposals. Enter sale price and cost basis from this report.",
    skatteverketGuideStep4: "Keep the separate income summary as support for interest, staking, rewards, and similar income.",
    skatteverketGuideLink: "Open Skatteverket's crypto guide",
    reportSummary: "Tax year {year} includes {rows} reviewed rows. K4 section D has {k4Rows} row{plural} with {profit} profit and {loss} loss before personal review. Other income is {income}.",
    k4Grouped: "K4 disposals grouped by asset and disposal event",
    incomeSummary: "Other income summary for rewards, earn, referrals, and bonuses",
    sekTrail: "SEK valuation trail with cached market and FX rates",
    costBasisMemo: "Cost basis recovery memo for missing acquisition history",
    whatThisMeans: "What this means",
    needsReview: "Needs review before filing",
    zeroCostFallbackRows: "{count} disposal rows use conservative zero-cost fallback.",
    manualSekPriceRows: "{count} rows need manual SEK price",
    incomeRowsIncluded: "{count} income rows included.",
    disposalRowsIncluded: "{count} disposal rows included.",
    k4SectionOtherAssets: "K4 section D - other assets",
    k4SectionHelp: "Transfer these rows to K4 section D for crypto disposals. Profit and loss are separated so they are not netted before entry. Digital upload requires SRU files.",
    salePrice: "Sale price",
    costBasis: "Cost basis",
    profitLoss: "Profit / loss",
    noK4Rows: "No K4 disposal rows for this tax year.",
    date: "Date",
    source: "Source",
    designation: "Designation",
    amount: "Amount",
    proceeds: "Proceeds",
    income: "Income",
    status: "Status",
    type: "Type",
    asset: "Asset",
    quantity: "Quantity",
    otherIncomeNotK4: "Other income - not K4",
    otherIncomeHelp: "Interest, staking, rewards, referrals, and similar income rows are listed separately for review.",
    otherIncomeDeclarationTitle: "How to use other income",
    otherIncomeDeclarationHelp: "This amount is not a K4 disposal result. For private interest, staking, earn, rewards, and similar return, the normal entry point is Inkomstdeklaration 1, section 7.2 Interest income, dividends, etc.",
    otherIncomeGuideStep1: "Open Inkomstdeklaration 1 and choose Change/add income under Income from capital.",
    otherIncomeGuideStep2: "Use section 7.2 Interest income, dividends, etc. for private crypto return such as interest, staking, earn, rewards, and similar income.",
    otherIncomeGuideStep3: "Enter the SEK total from this report. Keep the row list as supporting evidence for date, source, coin, quantity, and SEK value.",
    otherIncomeGuideStep4: "Use Other information to describe source and type, for example Binance/Abra crypto interest or staking rewards converted to SEK.",
    otherIncomeGuideExceptions: "Do not use 7.2 if the crypto was salary for work, business income, or a sale/exchange. Salary belongs under service, business income under business activity, and sales/exchanges belong on K4 section D.",
    skatteverketDeclarationGuideLink: "Open Skatteverket's declaration contents guide",
    noRows: "No rows.",
    signedInUser: "Signed-in user",
    working: "Working",
    keepTabOpen: "Keep this tab open while the secure server-side action runs.",
    dataOverview: "Data overview",
    dataOverviewHelp: "What is currently loaded for this tax year.",
    loaded: "Loaded",
    empty: "Empty",
    binanceDiscovery: "Binance discovery",
    importedRows: "Imported rows",
    csvRows: "CSV rows",
    report: "Report",
    notRun: "Not run",
    taxDraft: "Tax draft",
    taxDraftHelp: "Current result before personal review.",
    k4Result: "K4 result",
    estimatedTax: "Estimated tax",
    rowsReviewed: "Rows reviewed",
    openReport: "Open report",
    pricing: "Pricing",
    reviewWorkspace: "Review imported rows, SEK values, and report output.",
    createAccount: "Create account",
    name: "Name",
    email: "Email",
    password: "Password",
    saveReportsBilling: "Save reports and billing in your private workspace.",
    supabaseSignIn: "Sign-in is handled by Supabase.",
    useExistingAccount: "Use an existing account",
    createNewAccount: "Create a new account",
    checkingSignIn: "Checking sign-in",
    restoringSession: "CryptoTax Sweden is restoring your secure Supabase session.",
    switchTheme: "Switch to {theme} theme",
    dark: "Dark",
    light: "Light",
    transactionCountPricing: "Transaction-count pricing",
    transactionCountPricingHelp: "The selected package is based on total imported workspace transactions, excluding VAT where paid.",
    stripe: "Stripe",
    selectedPackage: "Selected package",
    paidPackagesAdd: "Paid packages add together up to {limit} transactions. The selected {plan} package adds {slots} slots.",
    paymentState: "Payment state",
    paymentStateHelp: "Workspace access is granted only by verified Stripe webhook fulfillment or server-side reconciliation.",
    startCheckout: "Start Checkout",
    manageBilling: "Manage billing",
    refreshInvoices: "Refresh invoices",
    paymentHistory: "Payment history & invoices",
    paymentHistoryHelp: "Invoices are fetched server-side from Stripe for your signed-in account.",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    refreshInvoicesAfterCheckout: "Refresh invoices after checkout to see Stripe invoice links here.",
    fetchingStripeInvoices: "Fetching Stripe invoices...",
    noInvoices: "No invoices found yet. Complete checkout first.",
    package: "Package",
    transactionSlots: "Transaction slots",
    total: "Total",
    invoice: "Invoice",
    openInvoice: "Open invoice",
    waiting: "Waiting",
    previewReady: "Preview ready",
    selected: "Selected",
    file: "File",
    sourceName: "Source",
    rowCount: "Rows",
    taxYearWorkspace: "Tax year workspace",
    binanceConnection: "Binance connection",
    binanceConnectionHelp: "Use your Binance Tax API key. Credentials are sent only to the Edge Function and stored encrypted server-side.",
    mainBinance: "Main Binance",
    runDiscovery: "Run discovery",
    rerunDiscovery: "Rerun discovery",
    importRefreshTransactions: "Import / refresh transactions",
    refreshTransactions: "Refresh transactions",
    connectionSettings: "Connection settings +",
    csvFallback: "CSV fallback",
    csvFallbackHelp: "Use only if Binance API misses a product area.",
    manual: "Manual",
    binanceTransactionCsv: "Binance transaction export CSV",
    binanceTaxApiKey: "Binance Tax API key",
    binanceTaxApiSecret: "Binance Tax API secret",
    label: "Label",
    saveKey: "Save key",
    connect: "Connect",
    replaceKey: "Replace key",
    cancel: "Cancel",
    keyHint: "Key {key}",
    generateBinanceKeyHelp: "Generate the key from Binance Tax/API reporting. Delete or rotate one-time import keys after use.",
    importCsvFallbackRows: "Import CSV fallback rows",
    discovery: "Discovery",
    discoveryHelp: "Validate the connected account and estimate the selected tax-year volume before importing.",
    runFirst: "Run first",
    noDiscoveryYet: "No discovery yet",
    connectRunDiscoveryForYear: "Connect Binance, then run discovery for tax year {year}.",
    discoverySourceForYear: "{source} for tax year {year}.",
    noSpotAssets: "No non-zero spot assets returned.",
    more: "more",
    items: "items",
    sample: "sample",
    coverageCheckHelp: "This is a lightweight coverage check. It does not import all product rows.",
    productCoverage: "Product coverage",
    productAreasReturned: "{found}/{checked} product areas returned data",
    connectApiRunDiscovery: "Connect API key and run discovery",
    importOtherCsv: "Import other CSV",
    optionalWalletCsv: "Optional wallet or exchange CSV",
    csvRowsImported: "CSV rows imported",
    csvRowsMapped: "{count} CSV rows mapped",
    reviewTransactions: "Review transactions",
    transactionRowsImported: "{count} transaction rows imported",
    workspaceRowsPriced: "{count} workspace rows priced",
    countApiRows: "Count API rows before payment",
    reviewTaxOutput: "Review tax output",
    reportDraftReady: "Report draft ready",
    recoverGenerateK4: "Recover cost basis and generate K4 values",
    importedTransactions: "Imported transactions",
    importedTransactionsHelp: "Imported rows for tax year {year}, sorted by type, asset, and date. These are the rows used for tax calculation.",
    rowsNeedManualSekPrice: "{count} imported rows need manual SEK price",
    missingPricingOne: "{assets} is missing automatic pricing.",
    missingPricingMany: "{assets} are missing automatic pricing.",
    missingPricingSome: "Some assets are missing automatic pricing.",
    refreshOrManualPrices: "Refresh Binance import or add manual prices for unsupported symbols.",
    openBinance: "Open Binance",
    coin: "Coin",
    all: "All",
    allTypes: "All types",
    allCoins: "All coins",
    sekPerUnit: "SEK / unit",
    estValue: "Est. value",
    basisStatus: "Basis status",
    confidence: "Confidence",
    csvTransactionImport: "CSV transaction import",
    csvTransactionImportHelp: "Upload a transaction CSV from another exchange or wallet. AI maps the columns, then you approve before importing.",
    csvFile: "CSV file",
    analyzeCsv: "Analyze CSV",
    mappingPreview: "Mapping preview",
    noCsvAnalyzed: "No CSV analyzed yet.",
    mappedRowsSelected: "{selected} of {total} mapped rows selected.",
    noPreview: "No preview",
    uploadCsvToMap: "Upload a transaction CSV to map it into the tax ledger.",
    rowsToImport: "Rows to import",
    rowsToImportHelp: "Review the normalized sample before approving the import.",
    approveImport: "Approve import",
    noRowsYet: "No rows yet",
    previewRowsHere: "The preview will show the first normalized rows here.",
    previousCsvImports: "Previous CSV imports",
    previousCsvImportsHelp: "Open an import to review the rows that were added from that file.",
    noCsvImportsYet: "No CSV imports yet",
    approvedCsvImportsAppear: "Approved CSV imports will appear here after they are added to the tax ledger.",
    reviewWarnings: "Review warnings",
    columnMapping: "Column mapping",
    coinsToInclude: "Coins to include",
    notes: "Notes",
    noMatchingTransactions: "No matching transactions",
    changeFilters: "Change the filters to see other imported rows.",
    noImportedTransactions: "No imported transactions yet",
    runDiscoveryImport: "Run discovery and start transaction import from the Binance page.",
    selectVisibleRows: "Select visible rows",
    selectTransaction: "Select transaction",
    actions: "Actions",
    loadMore: "Load more",
    shown: "shown",
    selectedRows: "{count} selected",
    selectAsset: "Select {asset}",
    bulkAfterCoin: "Bulk actions are available after choosing a coin.",
    selectVisible: "Select visible",
    clear: "Clear",
    excludeSelected: "Exclude selected",
    filteredRows: "{count} filtered rows",
    transactionActions: "Transaction actions",
    edit: "Edit",
    remove: "Remove",
    interest: "Interest",
    convert: "Convert",
    transfers: "Transfers",
    trades: "Trades",
    fees: "Fees",
    publicNav: "Public navigation",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    publicMobileNav: "Public mobile navigation",
    cryptoTaxHero: "Crypto tax reports for Sweden.",
    cryptoTaxLead: "Connect Binance, import CSV files from other exchanges or wallets with AI mapping, value every transaction in SEK, and generate K4-ready tax output.",
    binanceApiImport: "Binance API import",
    aiCsvClassification: "AI CSV classification",
    k4Output: "K4 section D output",
    viewPricing: "View pricing",
    signedInWorkspace: "Signed-in workspace",
    appPreviewAlt: "CryptoTax Sweden signed-in workspace with import, transactions, billing, and report flow",
    signedInWorkspaceHelp: "Import, review transactions, and generate the report from one private workspace.",
    coreStrengths: "Core product strengths",
    aiReadsCsv: "AI reads unknown CSV exports",
    aiReadsCsvHelp: "Upload CSV files from wallets or exchanges such as Abra. The app maps columns, classifies rows, and waits for your approval before import.",
    sekTrailTitle: "SEK valuation trail",
    sekTrailHelp: "Transactions are valued in SEK using cached crypto and FX rates, with unsupported assets clearly flagged for manual review.",
    k4IncomeApart: "K4 and income kept apart",
    k4IncomeApartHelp: "Disposals become K4 section D rows. Interest, staking, rewards, and referral income stay in a separate income summary.",
    workflow: "Workflow",
    workflowHeadline: "From raw exports to report.",
    pricingHeadline: "Pricing.",
    pricingHelp: "Based on total imported workspace transactions. Paid tiers exclude VAT.",
    secureAccess: "Secure access",
    startSecurely: "Start securely.",
    secureAccessHelp: "Connections, imports, reports, and billing stay behind sign-in.",
    getStarted: "Get started",
    transactionsAiReview: "{count} transactions + AI-assisted review.",
    transactionsPlain: "{count} transactions.",
    privateWorkspace: "Private workspace",
    authGateTitle: "Sign in to use CryptoTax Sweden.",
    authGateHelp: "Binance connections, imports, reports, billing, and account settings are available only after secure Supabase sign-in.",
    paid: "paid",
    pending: "pending",
  },
  sv: {
    dashboard: "Översikt",
    binance: "Binance",
    csvImport: "CSV-import",
    transactions: "Transaktioner",
    reports: "Rapporter",
    billing: "Betalning",
    account: "Konto",
    signIn: "Logga in",
    signedIn: "Inloggad",
    secureSignIn: "Säker Supabase-inloggning för sparade arbetsytor",
    taxYear: "Inkomstår",
    readyForDiscovery: "Redo för kontroll",
    ready: "Redo",
    connectBinance: "Anslut Binance Tax API-nyckel för att börja",
    taxableResult: "Beräknat skattepliktigt resultat från nuvarande transaktioner",
    language: "Språk",
    displayName: "Visningsnamn",
    active: "Aktivt",
    signedInAs: "Inloggad som",
    supabaseUser: "Supabase-användare",
    useUsdPeg: "Använd USD-peg för stablecoin-anskaffningsvärde",
    useUsdPegHelp: "USDT, USDC, FDUSD och DAI använder USD/SEK på transaktionsdatum som fallback när köphistorik saknas.",
    calculationSettings: "Inställningar för skatteberäkning",
    calculationSettingsHelp: "Standardval som används när appen prissätter och beräknar importerade transaktioner.",
    saveProfile: "Spara profil",
    profileTrust: "Inloggning hanteras säkert av Supabase. Om du har använt en annan tjänst från samma leverantör kan samma konto fungera här.",
    signOut: "Logga ut",
    uploadedSlotsTitle: "Uppladdade transaktioner / köpta transaktionsplatser",
    inYear: "under",
    generated: "Genererad",
    draft: "Utkast",
    rows: "rader",
    reportGenerated: "Rapport genererad.",
    k4Report: "K4-rapport",
    k4ReportHelp: "Skapa ett K4-underlag för avsnitt D till Skatteverket och håll inkomstrader separat.",
    k4SectionRows: "K4 avsnitt D-rader",
    k4Profit: "K4-vinst",
    k4Loss: "K4-förlust",
    otherIncome: "Övrig inkomst",
    generateReport: "Generera rapport",
    saveK4Pdf: "Spara K4 PDF",
    downloadK4Csv: "Ladda ner K4 CSV",
    auditExplanation: "Revisionsförklaring",
    auditExplanationHelp: "Kopiera detta till egna granskningsanteckningar eller underlag till redovisningshjälp.",
    digitalFilingNote: "Notering om digital inlämning",
    digitalFilingHelp: "Skatteverkets digitala filöverföring använder SRU-filer. Denna PDF/CSV är ett gransknings- och inmatningsunderlag för K4 avsnitt D, inte en SRU-fil.",
    skatteverketGuideTitle: "Var fyller du i detta hos Skatteverket",
    skatteverketGuideHelp: "I Skatteverkets e-tjänst Inkomstdeklaration 1 lägger du till bilaga K4 och använder avsnitt D för krypto och andra tillgångar.",
    skatteverketGuideStep1: "Öppna Inkomstdeklaration 1 och gå till bilagor.",
    skatteverketGuideStep2: "Välj K4 - Övriga värdepapper, andra tillgångar m.m.",
    skatteverketGuideStep3: "Använd avsnitt D för kryptoavyttringar. Fyll i försäljningspris och omkostnadsbelopp från rapporten.",
    skatteverketGuideStep4: "Spara den separata inkomstsammanställningen som underlag för ränta, staking, rewards och liknande inkomster.",
    skatteverketGuideLink: "Öppna Skatteverkets kryptoguide",
    reportSummary: "Inkomstår {year} innehåller {rows} granskade rader. K4 avsnitt D har {k4Rows} rad{plural} med {profit} vinst och {loss} förlust före personlig granskning. Övrig inkomst är {income}.",
    k4Grouped: "K4-avyttringar grupperade per tillgång och avyttringshändelse",
    incomeSummary: "Sammanställning av övrig inkomst från ränta, staking, bonusar och referrals",
    sekTrail: "SEK-värderingsspår med cachade marknads- och valutakurser",
    costBasisMemo: "Anskaffningsvärdesnotering för saknad köphistorik",
    whatThisMeans: "Vad detta betyder",
    needsReview: "Behöver granskas före deklaration",
    zeroCostFallbackRows: "{count} avyttringsrader använder konservativt anskaffningsvärde 0 kr.",
    manualSekPriceRows: "{count} rader behöver manuellt SEK-pris",
    incomeRowsIncluded: "{count} inkomstrader ingår.",
    disposalRowsIncluded: "{count} avyttringsrader ingår.",
    k4SectionOtherAssets: "K4 avsnitt D - övriga tillgångar",
    k4SectionHelp: "För över dessa rader till K4 avsnitt D för kryptoavyttringar. Vinst och förlust hålls separata så att de inte nettas före inmatning. Digital uppladdning kräver SRU-filer.",
    salePrice: "Försäljningspris",
    costBasis: "Omkostnadsbelopp",
    profitLoss: "Vinst / förlust",
    noK4Rows: "Inga K4-avyttringsrader för valt inkomstår.",
    date: "Datum",
    source: "Källa",
    designation: "Beteckning",
    amount: "Antal / belopp",
    proceeds: "Försäljningspris",
    income: "Inkomst",
    status: "Status",
    type: "Typ",
    asset: "Tillgång",
    quantity: "Antal",
    otherIncomeNotK4: "Övrig inkomst - inte K4",
    otherIncomeHelp: "Ränta, staking, rewards, referrals och liknande inkomstrader listas separat för granskning.",
    otherIncomeDeclarationTitle: "Så används övrig inkomst",
    otherIncomeDeclarationHelp: "Detta belopp är inte ett K4-resultat från avyttring. För privat ränta, staking, earn, rewards och liknande avkastning är det normala inmatningsstället Inkomstdeklaration 1, punkt 7.2 Ränteinkomster, utdelningar m.m.",
    otherIncomeGuideStep1: "Öppna Inkomstdeklaration 1 och välj ändra/lägg till inkomst under Inkomst av kapital.",
    otherIncomeGuideStep2: "Använd punkt 7.2 Ränteinkomster, utdelningar m.m. för privat kryptoavkastning som ränta, staking, earn, rewards och liknande inkomster.",
    otherIncomeGuideStep3: "Fyll i SEK-summan från rapporten. Spara radlistan som underlag för datum, källa, coin, antal och SEK-värde.",
    otherIncomeGuideStep4: "Använd Övriga upplysningar för att beskriva källa och typ, till exempel Binance/Abra kryptoränta eller staking rewards omräknat till SEK.",
    otherIncomeGuideExceptions: "Använd inte 7.2 om krypton var lön för arbete, näringsinkomst eller försäljning/byte. Lön hör till tjänst, näringsinkomst till näringsverksamhet och försäljning/byte till K4 avsnitt D.",
    skatteverketDeclarationGuideLink: "Öppna Skatteverkets guide om deklarationens innehåll",
    noRows: "Inga rader.",
    signedInUser: "Inloggad användare",
    working: "Arbetar",
    keepTabOpen: "Håll fliken öppen medan serveråtgärden körs säkert.",
    dataOverview: "Dataöversikt",
    dataOverviewHelp: "Det som är inläst för valt inkomstår.",
    loaded: "Inläst",
    empty: "Tomt",
    binanceDiscovery: "Binance-kontroll",
    importedRows: "Importerade rader",
    csvRows: "CSV-rader",
    report: "Rapport",
    notRun: "Ej körd",
    taxDraft: "Skatteutkast",
    taxDraftHelp: "Nuvarande resultat före personlig granskning.",
    k4Result: "K4-resultat",
    estimatedTax: "Beräknad skatt",
    rowsReviewed: "Granskade rader",
    openReport: "Öppna rapport",
    pricing: "Priser",
    reviewWorkspace: "Granska importerade rader, SEK-värden och rapportunderlag.",
    createAccount: "Skapa konto",
    name: "Namn",
    email: "E-post",
    password: "Lösenord",
    saveReportsBilling: "Spara rapporter och betalning i din privata arbetsyta.",
    supabaseSignIn: "Inloggning hanteras av Supabase.",
    useExistingAccount: "Använd befintligt konto",
    createNewAccount: "Skapa nytt konto",
    checkingSignIn: "Kontrollerar inloggning",
    restoringSession: "CryptoTax Sweden återställer din säkra Supabase-session.",
    switchTheme: "Byt till {theme} tema",
    dark: "Mörkt",
    light: "Ljust",
    transactionCountPricing: "Pris per transaktionsantal",
    transactionCountPricingHelp: "Valt paket baseras på totalt antal importerade transaktioner i arbetsytan, exklusive moms där den betalats.",
    stripe: "Stripe",
    selectedPackage: "Valt paket",
    paidPackagesAdd: "Betalda paket läggs ihop upp till {limit} transaktioner. Det valda paketet {plan} lägger till {slots} platser.",
    paymentState: "Betalningsstatus",
    paymentStateHelp: "Åtkomst ges endast efter verifierad Stripe-webhook eller serveravstämning.",
    startCheckout: "Starta betalning",
    manageBilling: "Hantera betalning",
    refreshInvoices: "Uppdatera fakturor",
    paymentHistory: "Betalningshistorik och fakturor",
    paymentHistoryHelp: "Fakturor hämtas server-side från Stripe för ditt inloggade konto.",
    refresh: "Uppdatera",
    refreshing: "Uppdaterar...",
    refreshInvoicesAfterCheckout: "Uppdatera fakturor efter betalning för att se Stripe-länkar här.",
    fetchingStripeInvoices: "Hämtar Stripe-fakturor...",
    noInvoices: "Inga fakturor hittades ännu. Slutför betalning först.",
    package: "Paket",
    transactionSlots: "Transaktionsplatser",
    total: "Totalt",
    invoice: "Faktura",
    openInvoice: "Öppna faktura",
    waiting: "Väntar",
    previewReady: "Förhandsvisning klar",
    selected: "Valda",
    file: "Fil",
    sourceName: "Källa",
    rowCount: "Rader",
    taxYearWorkspace: "Arbetsyta för inkomstår",
    binanceConnection: "Binance-anslutning",
    binanceConnectionHelp: "Använd din Binance Tax API-nyckel. Uppgifterna skickas bara till Edge Function och lagras krypterat server-side.",
    mainBinance: "Main Binance",
    runDiscovery: "Kör kontroll",
    rerunDiscovery: "Kör kontroll igen",
    importRefreshTransactions: "Importera / uppdatera transaktioner",
    refreshTransactions: "Uppdatera transaktioner",
    connectionSettings: "Anslutningsinställningar +",
    csvFallback: "CSV-reserv",
    csvFallbackHelp: "Använd bara om Binance API saknar ett produktområde.",
    manual: "Manuell",
    binanceTransactionCsv: "Binance transaktions-export CSV",
    binanceTaxApiKey: "Binance Tax API-nyckel",
    binanceTaxApiSecret: "Binance Tax API-secret",
    label: "Etikett",
    saveKey: "Spara nyckel",
    connect: "Anslut",
    replaceKey: "Byt nyckel",
    cancel: "Avbryt",
    keyHint: "Nyckel {key}",
    generateBinanceKeyHelp: "Skapa nyckeln från Binance Tax/API reporting. Radera eller rotera engångsnycklar efter import.",
    importCsvFallbackRows: "Importera CSV-reservrader",
    discovery: "Kontroll",
    discoveryHelp: "Verifiera det anslutna kontot och uppskatta volymen för valt inkomstår före import.",
    runFirst: "Kör först",
    noDiscoveryYet: "Ingen kontroll ännu",
    connectRunDiscoveryForYear: "Anslut Binance och kör sedan kontroll för inkomstår {year}.",
    discoverySourceForYear: "{source} för inkomstår {year}.",
    noSpotAssets: "Inga spot-tillgångar med saldo hittades.",
    more: "till",
    items: "poster",
    sample: "urval",
    coverageCheckHelp: "Detta är en lätt kontroll av produktområden. Den importerar inte alla produktrader.",
    productCoverage: "Produktområden",
    productAreasReturned: "{found}/{checked} produktområden gav data",
    connectApiRunDiscovery: "Anslut API-nyckel och kör kontroll",
    importOtherCsv: "Importera annan CSV",
    optionalWalletCsv: "Valfri CSV från wallet eller börs",
    csvRowsImported: "CSV-rader importerade",
    csvRowsMapped: "{count} CSV-rader mappade",
    reviewTransactions: "Granska transaktioner",
    transactionRowsImported: "{count} transaktionsrader importerade",
    workspaceRowsPriced: "{count} arbetsyterader prissatta",
    countApiRows: "Räkna API-rader före betalning",
    reviewTaxOutput: "Granska skatteunderlag",
    reportDraftReady: "Rapportutkast klart",
    recoverGenerateK4: "Räkna anskaffningsvärde och skapa K4-värden",
    importedTransactions: "Importerade transaktioner",
    importedTransactionsHelp: "Importerade rader för inkomstår {year}, sorterade på typ, tillgång och datum. Dessa rader används för skatteberäkningen.",
    rowsNeedManualSekPrice: "{count} importerade rader behöver manuellt SEK-pris",
    missingPricingOne: "{assets} saknar automatisk prissättning.",
    missingPricingMany: "{assets} saknar automatisk prissättning.",
    missingPricingSome: "Vissa tillgångar saknar automatisk prissättning.",
    refreshOrManualPrices: "Uppdatera Binance-importen eller lägg till manuella priser för symboler som inte stöds.",
    openBinance: "Öppna Binance",
    coin: "Coin",
    all: "Alla",
    allTypes: "Alla typer",
    allCoins: "Alla coins",
    sekPerUnit: "SEK / enhet",
    estValue: "Beräknat värde",
    basisStatus: "Anskaffningsstatus",
    confidence: "Säkerhet",
    csvTransactionImport: "CSV-transaktionsimport",
    csvTransactionImportHelp: "Ladda upp en transaktions-CSV från en annan börs eller wallet. AI mappar kolumnerna, sedan godkänner du importen.",
    csvFile: "CSV-fil",
    analyzeCsv: "Analysera CSV",
    mappingPreview: "Mappningsförhandsvisning",
    noCsvAnalyzed: "Ingen CSV analyserad ännu.",
    mappedRowsSelected: "{selected} av {total} mappade rader valda.",
    noPreview: "Ingen förhandsvisning",
    uploadCsvToMap: "Ladda upp en transaktions-CSV för att mappa den till skatteunderlaget.",
    rowsToImport: "Rader att importera",
    rowsToImportHelp: "Granska det normaliserade urvalet innan du godkänner importen.",
    approveImport: "Godkänn import",
    noRowsYet: "Inga rader ännu",
    previewRowsHere: "Förhandsvisningen visar de första normaliserade raderna här.",
    previousCsvImports: "Tidigare CSV-importer",
    previousCsvImportsHelp: "Öppna en import för att granska raderna som lades till från filen.",
    noCsvImportsYet: "Inga CSV-importer ännu",
    approvedCsvImportsAppear: "Godkända CSV-importer visas här efter att de lagts till i skatteunderlaget.",
    reviewWarnings: "Granska varningar",
    columnMapping: "Kolumnmappning",
    coinsToInclude: "Coins att ta med",
    notes: "Anteckningar",
    noMatchingTransactions: "Inga matchande transaktioner",
    changeFilters: "Ändra filtren för att se andra importerade rader.",
    noImportedTransactions: "Inga importerade transaktioner ännu",
    runDiscoveryImport: "Kör kontroll och starta transaktionsimport från Binance-sidan.",
    selectVisibleRows: "Välj synliga rader",
    selectTransaction: "Välj transaktion",
    actions: "Åtgärder",
    loadMore: "Ladda fler",
    shown: "visas",
    selectedRows: "{count} valda",
    selectAsset: "Välj {asset}",
    bulkAfterCoin: "Massåtgärder är tillgängliga efter att du valt ett coin.",
    selectVisible: "Välj synliga",
    clear: "Rensa",
    excludeSelected: "Exkludera valda",
    filteredRows: "{count} filtrerade rader",
    transactionActions: "Transaktionsåtgärder",
    edit: "Redigera",
    remove: "Ta bort",
    interest: "Ränta",
    convert: "Växling",
    transfers: "Överföringar",
    trades: "Trades",
    fees: "Avgifter",
    publicNav: "Publik navigation",
    openMenu: "Öppna meny",
    closeMenu: "Stäng meny",
    publicMobileNav: "Publik mobilnavigation",
    cryptoTaxHero: "Kryptorapporter för svensk deklaration.",
    cryptoTaxLead: "Anslut Binance, importera CSV-filer från andra börser eller wallets med AI-mappning, värdera varje transaktion i SEK och skapa K4-klart skatteunderlag.",
    binanceApiImport: "Binance API-import",
    aiCsvClassification: "AI-klassning av CSV",
    k4Output: "K4 avsnitt D-underlag",
    viewPricing: "Visa priser",
    signedInWorkspace: "Inloggad arbetsyta",
    appPreviewAlt: "Inloggad CryptoTax Sweden-arbetsyta med import, transaktioner, betalning och rapportflöde",
    signedInWorkspaceHelp: "Importera, granska transaktioner och skapa rapporten från en privat arbetsyta.",
    coreStrengths: "Produktens kärna",
    aiReadsCsv: "AI läser okända CSV-exporter",
    aiReadsCsvHelp: "Ladda upp CSV-filer från wallets eller börser som Abra. Appen mappar kolumner, klassar rader och väntar på ditt godkännande före import.",
    sekTrailTitle: "SEK-värderingsspår",
    sekTrailHelp: "Transaktioner värderas i SEK med cachade krypto- och valutakurser, och tillgångar som inte stöds flaggas tydligt för manuell granskning.",
    k4IncomeApart: "K4 och inkomst hålls isär",
    k4IncomeApartHelp: "Avyttringar blir K4 avsnitt D-rader. Ränta, staking, rewards och referrals ligger kvar i en separat inkomstsammanställning.",
    workflow: "Arbetsflöde",
    workflowHeadline: "Från rå export till rapport.",
    pricingHeadline: "Priser.",
    pricingHelp: "Baseras på totalt antal importerade transaktioner i arbetsytan. Betalda paket visas exklusive moms.",
    secureAccess: "Säker åtkomst",
    startSecurely: "Kom igång säkert.",
    secureAccessHelp: "Anslutningar, importer, rapporter och betalning ligger bakom inloggning.",
    getStarted: "Kom igång",
    transactionsAiReview: "{count} transaktioner + AI-assisterad granskning.",
    transactionsPlain: "{count} transaktioner.",
    privateWorkspace: "Privat arbetsyta",
    authGateTitle: "Logga in för att använda CryptoTax Sweden.",
    authGateHelp: "Binance-anslutningar, importer, rapporter, betalning och kontoinställningar är bara tillgängliga efter säker Supabase-inloggning.",
    paid: "betald",
    pending: "väntar",
  },
};

const navItems = [
  { route: "dashboard", labelKey: "dashboard", icon: icons.dashboard },
  { route: "binance", labelKey: "binance", icon: icons.binance },
  { route: "ai-import", labelKey: "csvImport", icon: icons.aiImport },
  { route: "transactions", labelKey: "transactions", icon: icons.transactions },
  { route: "reports", labelKey: "reports", icon: icons.report },
  { route: "billing", labelKey: "billing", icon: icons.billing },
  { route: "account", labelKey: "account", icon: icons.account },
];

function currentLanguage() {
  const appSettings = state.auth.profile?.app_settings && typeof state.auth.profile.app_settings === "object" ? state.auth.profile.app_settings : {};
  return appSettings.language === "sv" ? "sv" : "en";
}

function t(key) {
  const language = currentLanguage();
  return uiText[language]?.[key] || uiText.en[key] || key;
}

function tr(key, values = {}) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), t(key));
}

function setState(patch) {
  Object.assign(state, patch);
  if (patch.route) appStorage.setLocal("route", state.route);
  if (Object.prototype.hasOwnProperty.call(patch, "theme")) {
    state.theme = normalizeTheme(state.theme);
    appStorage.setLocal("theme", state.theme);
    applyTheme(state.theme);
  }
  if (patch.selectedPlan) appStorage.setLocal("selectedPlan", state.selectedPlan);
  if (patch.selectedTaxYear) appStorage.setLocal("selectedTaxYear", state.selectedTaxYear);
  if (patch.transactions) appStorage.setSession("transactions", state.transactions);
  if (patch.connection) appStorage.setSession("connection", state.connection);
  if (Object.prototype.hasOwnProperty.call(patch, "discovery")) appStorage.setSession("discovery", state.discovery);
  if (Object.prototype.hasOwnProperty.call(patch, "importPreview")) appStorage.setSession("importPreview", state.importPreview);
  if (patch.openingBalances) appStorage.setSession("openingBalances", state.openingBalances);
  if (Object.prototype.hasOwnProperty.call(patch, "statementDraft")) appStorage.setSession("statementDraft", state.statementDraft);
  if (Object.prototype.hasOwnProperty.call(patch, "report")) appStorage.setSession("report", state.report);
  if (Object.prototype.hasOwnProperty.call(patch, "aiImport")) appStorage.setSession("aiImport", state.aiImport);
  if (Object.prototype.hasOwnProperty.call(patch, "excludedTransactionIds")) appStorage.setSession("excludedTransactionIds", state.excludedTransactionIds);
  render();
}

function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

function getPreferredTheme() {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches) return "dark";
  return "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = normalizeTheme(theme);
}

function withLoading(text, task) {
  setState({ loading: true, loadingText: text, error: "", notice: "" });
  return Promise.resolve()
    .then(task)
    .catch((error) => {
      setState({ error: error.message || "Something went wrong.", notice: "" });
    })
    .finally(() => {
      setState({ loading: false, loadingText: "" });
    });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function selectedPlan() {
  return planCatalog.find((plan) => plan.key === state.selectedPlan) || planCatalog[0];
}

function planName(planKey) {
  return (planCatalog.find((plan) => plan.key === planKey) || selectedPlan()).name;
}

function planByKey(planKey) {
  return planCatalog.find((plan) => plan.key === planKey) || null;
}

function paymentTransactionSlots(payment) {
  const plan = planByKey(payment?.planKey);
  return Number(payment?.maxTransactions || plan?.maxTransactions || 0);
}

function workspaceTransactionSlots() {
  const payments = Array.isArray(state.billingHistory?.payments) ? state.billingHistory.payments : [];
  const paidSlots = payments
    .filter((payment) => ["paid", "active"].includes(String(payment.status || "").toLowerCase()))
    .reduce((total, payment) => total + paymentTransactionSlots(payment), 0);
  return Math.min(SELF_SERVICE_TRANSACTION_LIMIT, paidSlots || Number(selectedPlan().maxTransactions || 0));
}

function yearStartStatementDate(taxYear = state.selectedTaxYear) {
  return `${Number(taxYear) - 1}-12-31`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("sv-SE");
}

function formatMaybe(value) {
  if (value === null || value === undefined || value === "") return "Not returned";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatAssetQuantity(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("sv-SE", { maximumFractionDigits: 8 });
}

function parseNumberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^0-9,.\-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function rowValue(row, keys) {
  const normalized = new Map(
    Object.entries(row || {}).map(([key, value]) => [String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value]),
  );
  for (const key of keys) {
    const value = normalized.get(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function selectedYearDiscovery() {
  if (!state.discovery) return null;
  return Number(state.discovery.taxYear) === Number(state.selectedTaxYear) ? state.discovery : null;
}

function selectedYearImportPreview() {
  if (!state.importPreview) return null;
  if (!state.importPreview.taxYear) return state.importPreview;
  return Number(state.importPreview.taxYear) === Number(state.selectedTaxYear) ? state.importPreview : null;
}

function selectedYearOpeningBalances() {
  const statementDate = yearStartStatementDate();
  return state.openingBalances.filter((row) => String(row.statementDate || "").slice(0, 10) === statementDate);
}

function selectedYearStatementDraft() {
  if (!state.statementDraft) return null;
  const draftDate = String(state.statementDraft.statementDate || "").slice(0, 10);
  return !draftDate || draftDate === yearStartStatementDate() ? state.statementDraft : null;
}

function selectedYearTransactions() {
  const year = Number(state.selectedTaxYear);
  const excluded = new Set(state.excludedTransactionIds || []);
  return state.transactions.filter((item) => {
    const date = new Date(String(item.date || item.traded_at || ""));
    const id = transactionRowId(item);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === year && !excluded.has(id);
  });
}

function selectedYearImportedTransactions() {
  const year = Number(state.selectedTaxYear);
  return state.transactions.filter((item) => {
    const date = new Date(String(item.date || item.traded_at || ""));
    return !Number.isNaN(date.getTime()) && date.getFullYear() === year;
  });
}

function selectedYearReport() {
  if (!state.report) return null;
  if (!state.report.taxYear) return null;
  return Number(state.report.taxYear) === Number(state.selectedTaxYear) ? state.report : null;
}

function summarizeTransactions(transactions = state.transactions) {
  return taxCalculationRows(transactions).reduce(
    (summary, item) => {
      const proceeds = transactionProceedsSek(item);
      const cost = transactionCostBasisSek(item);
      const income = transactionIncomeSek(item);
      const gain = proceeds > 0 || cost > 0 ? proceeds - cost : 0;
      summary.proceeds += proceeds;
      summary.cost += cost;
      summary.gain += gain;
      summary.income += income;
      return summary;
    },
    { proceeds: 0, cost: 0, gain: 0, income: 0, count: transactions.length },
  );
}

function sanitizeStoredTransactions(transactions) {
  if (!Array.isArray(transactions)) return [];
  const seededFingerprints = new Set(["2025-02-14|BTC|54820", "2025-06-03|ETH|41800", "2025-11-28|BNB|0"]);
  const cleaned = transactions.filter((item) => {
    const fingerprint = `${item?.date || item?.traded_at || ""}|${item?.asset || item?.asset_symbol || ""}|${item?.proceedsSek || item?.proceeds_sek || 0}`;
    return !seededFingerprints.has(fingerprint);
  });
  if (cleaned.length !== transactions.length) appStorage.setSession("transactions", cleaned);
  return cleaned;
}

function mergeTransactions(existingRows, incomingRows) {
  const byId = new Map();
  for (const row of sanitizeStoredTransactions(existingRows)) {
    byId.set(String(row.externalId || row.external_id || `${row.date || row.traded_at}:${row.asset || row.asset_symbol}:${row.quantity}`), row);
  }
  for (const row of sanitizeStoredTransactions(incomingRows)) {
    byId.set(String(row.externalId || row.external_id || `${row.date || row.traded_at}:${row.asset || row.asset_symbol}:${row.quantity}`), row);
  }
  return Array.from(byId.values());
}

let workspaceHydrationKey = "";
let workspaceHydrationPromise = null;

function transactionYear(row) {
  const date = new Date(String(row?.date || row?.traded_at || ""));
  return Number.isNaN(date.getTime()) ? null : date.getFullYear();
}

function replaceTransactionsForYear(existingRows, taxYear, yearRows) {
  const year = Number(taxYear);
  const keptRows = sanitizeStoredTransactions(existingRows).filter((row) => transactionYear(row) !== year);
  return mergeTransactions(keptRows, yearRows);
}

function normalizeDbConnection(row) {
  if (!row) return { status: "not_connected", label: "No Binance connection" };
  return {
    id: row.id,
    status: row.status || "connected",
    label: row.label || "Main Binance",
    apiKeyHint: row.api_key_hint || row.apiKeyHint || "",
    permissions: row.permissions || {},
    lastCheckedAt: row.last_checked_at || row.updated_at || row.created_at || "",
  };
}

function normalizeDbTransaction(row, importJobById) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === "object" ? raw.raw : raw;
  const importJob = importJobById.get(row.import_job_id) || null;
  const metadata = importJob?.metadata && typeof importJob.metadata === "object" ? importJob.metadata : {};
  const sourceName =
    raw.sourceName ||
    raw.source_name ||
    nestedRaw.sourceName ||
    nestedRaw.source_name ||
    metadata.sourceName ||
    metadata.source_name ||
    importJob?.source ||
    "Imported";
  const existingCsvImport =
    raw.csvImport && typeof raw.csvImport === "object"
      ? raw.csvImport
      : nestedRaw.csvImport && typeof nestedRaw.csvImport === "object"
        ? nestedRaw.csvImport
        : null;
  const sourceKey = String(sourceName || "").toLowerCase();
  const csvImport =
    existingCsvImport ||
    (sourceKey && !sourceKey.includes("binance") && sourceKey !== "imported"
      ? {
          batchId: row.import_job_id || `${sourceName}:${String(row.traded_at || "").slice(0, 10)}`,
          sourceName,
          fileName: metadata.fileName || metadata.file_name || raw.fileName || nestedRaw.fileName || `${sourceName} CSV`,
          importedAt: importJob?.finished_at || importJob?.created_at || row.created_at || "",
        }
      : null);
  return {
    ...row,
    externalId: row.external_id || row.id,
    date: row.traded_at,
    type: row.type || "trade",
    asset: row.asset_symbol || "",
    quantity: Number(row.quantity || 0) || 0,
    feeAsset: row.fee_asset_symbol || "",
    feeQuantity: Number(row.fee_quantity || 0) || 0,
    proceedsSek: Number(row.proceeds_sek || 0) || 0,
    costSek: Number(row.cost_basis_sek || 0) || 0,
    incomeSek: Number(row.income_sek || 0) || 0,
    confidence: Number(row.confidence || 0) || 0,
    notes: row.notes || "",
    raw: {
      ...raw,
      sourceName,
      ...(csvImport ? { csvImport } : {}),
    },
  };
}

function normalizeDbOpeningBalance(row) {
  return {
    ...row,
    asset: row.asset_symbol || row.asset || "",
    quantity: Number(row.quantity || 0) || 0,
    averageCostSek: Number(row.average_cost_sek || row.cost_basis_sek || 0) || 0,
    priceUsd: Number(row.price_usd || 0) || 0,
    valueUsd: Number(row.value_usd || 0) || 0,
    statementDate: String(row.statement_date || row.statementDate || "").slice(0, 10),
    costBasisStatus: row.cost_basis_status || "unknown",
  };
}

function normalizeDbReport(row, taxYear) {
  if (!row) return null;
  const k4Summary = row.k4_summary && typeof row.k4_summary === "object" ? row.k4_summary : {};
  const incomeSummary = row.income_summary && typeof row.income_summary === "object" ? row.income_summary : {};
  const auditSummary = row.audit_summary && typeof row.audit_summary === "object" ? row.audit_summary : {};
  return {
    ...row,
    id: row.id,
    taxYear: Number(taxYear),
    status: row.status || "generated",
    generatedAt: row.generated_at || row.updated_at || row.created_at || "",
    explanation: row.explanation || auditSummary.explanation || "",
    summary: {
      ...k4Summary,
      ...incomeSummary,
      auditSummary,
    },
  };
}

function discoveryFromAuditEvent(auditEvent, taxYearRow, transactions) {
  const details = auditEvent?.details && typeof auditEvent.details === "object" ? auditEvent.details : null;
  if (!details) return null;
  const rawCoverage = Array.isArray(details.product_coverage) ? details.product_coverage : [];
  const productCoverage = rawCoverage.map((item) => {
    const key = String(item?.key || "");
    const meta = DISCOVERY_PRODUCT_META[key] || {};
    const count = Number(item?.count || item?.rowCount || item?.rows || 0) || 0;
    return {
      key,
      label: item?.label || meta.label || key || "Product",
      status: item?.status || (count > 0 ? "found" : "empty"),
      count,
      group: item?.group || meta.group || "",
      sampled: Boolean(item?.sampled),
      message: item?.message || "",
    };
  });
  const nonZeroAssets = Array.isArray(details.non_zero_assets)
    ? details.non_zero_assets.map((asset) => String(asset).toUpperCase()).filter(Boolean).slice(0, 80)
    : Array.from(new Set((transactions || []).map((row) => String(row.asset || row.asset_symbol || "").toUpperCase()).filter(Boolean))).slice(0, 80);
  const accountSummary = details.account_summary || details.account || null;
  return sanitizeStoredDiscovery({
    taxYear: Number(taxYearRow?.tax_year || state.selectedTaxYear),
    status: taxYearRow?.status || "discovered",
    checkedAt: auditEvent?.created_at || taxYearRow?.updated_at || "",
    source: details.source || "binance_account_snapshot",
    sourceLabel: details.source_label || "Binance product discovery",
    recordCount: Number(details.record_count || taxYearRow?.transaction_count || transactions?.length || 0) || 0,
    recordCountVerified: Boolean(details.record_count_verified),
    estimatedRows: Number(details.estimated_rows || taxYearRow?.transaction_count || transactions?.length || 0) || 0,
    recommendedPlan: details.recommended_plan || taxYearRow?.selected_plan_key || state.selectedPlan || "free",
    nonZeroAssets,
    nonZeroAssetCount: Number(details.non_zero_asset_count ?? nonZeroAssets.length) || 0,
    account: accountSummary,
    yearEndStatements: details.year_end_statements || [],
    productCoverage,
    productAreasChecked: Number(details.product_areas_checked || productCoverage.length) || 0,
    productAreasFound: Number(details.product_areas_found || productCoverage.filter((item) => item.status === "found" || item.status === "imported" || item.count > 0).length) || 0,
    message: details.message || "Discovery checks Binance product areas with lightweight endpoint probes. It is not a full transaction import.",
    canImportDirectly: Boolean(details.can_import_directly),
  });
}

function discoveryFromSavedData(auditEvent, importJobs, taxYearRow, transactions) {
  return discoveryFromAuditEvent(auditEvent, taxYearRow, transactions) || discoveryFromImportJobs(importJobs, taxYearRow, transactions);
}
function discoveryFromImportJobs(importJobs, taxYearRow, transactions) {
  const jobs = Array.isArray(importJobs) ? importJobs : [];
  const job = jobs.find((item) => Array.isArray(item?.metadata?.product_summaries) && item.metadata.product_summaries.length);
  if (!job && !taxYearRow) return null;
  const summaries = Array.isArray(job?.metadata?.product_summaries) ? job.metadata.product_summaries : [];
  const productCoverage = summaries.map((item) => {
    const count = Number(item.count || item.rowCount || item.rows || 0) || 0;
    return {
      key: item.key || item.product || item.label || "product",
      label: item.label || item.product || item.key || "Product",
      status: item.status || (count > 0 ? "found" : "empty"),
      count,
      group: item.group || "",
      message: item.message || "",
    };
  });
  const nonZeroAssets = Array.from(new Set((transactions || []).map((row) => String(row.asset || row.asset_symbol || "").toUpperCase()).filter(Boolean))).slice(0, 80);
  return sanitizeStoredDiscovery({
    taxYear: Number(taxYearRow?.tax_year || state.selectedTaxYear),
    status: job?.status || "discovered",
    checkedAt: job?.finished_at || job?.updated_at || job?.created_at || taxYearRow?.updated_at || "",
    source: "binance_account_snapshot",
    sourceLabel: "Binance account snapshot",
    recordCount: Number(taxYearRow?.transaction_count || job?.transaction_count || transactions?.length || 0) || 0,
    recordCountVerified: Boolean(transactions?.length),
    estimatedRows: Number(taxYearRow?.transaction_count || job?.transaction_count || transactions?.length || 0) || 0,
    recommendedPlan: taxYearRow?.selected_plan_key || state.selectedPlan || "free",
    nonZeroAssets,
    nonZeroAssetCount: nonZeroAssets.length,
    productCoverage,
    productAreasChecked: productCoverage.length,
    productAreasFound: productCoverage.filter((item) => item.status === "found" || item.count > 0).length,
    canImportDirectly: true,
  });
}

async function hydrateWorkspaceFromDatabase(options = {}) {
  if (!state.auth.user) return null;
  const key = `${state.auth.user.id}:${state.selectedTaxYear}`;
  if (workspaceHydrationKey === key && workspaceHydrationPromise) return workspaceHydrationPromise;
  workspaceHydrationKey = key;
  workspaceHydrationPromise = (async () => {
    try {
      const [connectionRows, taxYearRow] = await Promise.all([
        listBinanceConnections(),
        getTaxYearByYear(state.selectedTaxYear),
      ]);
      const connection = normalizeDbConnection((connectionRows || [])[0]);
      if (!taxYearRow) {
        setState({
          connection,
          transactions: replaceTransactionsForYear(state.transactions, state.selectedTaxYear, []),
          discovery: null,
          importPreview: null,
          openingBalances: [],
          report: null,
          selectedTransactionIds: [],
          error: "",
        });
        return null;
      }
      const [importJobs, dbTransactions, openingBalances, latestReport, discoveryAuditEvent] = await Promise.all([
        listImportJobs(taxYearRow.id),
        listTransactions(taxYearRow.id),
        listOpeningBalances(taxYearRow.id),
        getLatestReportForTaxYear(taxYearRow.id),
        getLatestAuditEventForTaxYear(taxYearRow.id, "discovery_completed"),
      ]);
      const importJobById = new Map((importJobs || []).map((job) => [job.id, job]));
      const normalizedTransactions = (dbTransactions || []).map((row) => normalizeDbTransaction(row, importJobById));
      const mergedTransactions = replaceTransactionsForYear(state.transactions, taxYearRow.tax_year, normalizedTransactions);
      setState({
        connection,
        transactions: mergedTransactions,
        discovery: discoveryFromSavedData(discoveryAuditEvent, importJobs, taxYearRow, normalizedTransactions),
        importPreview: null,
        openingBalances: (openingBalances || []).map(normalizeDbOpeningBalance),
        report: normalizeDbReport(latestReport, taxYearRow.tax_year),
        selectedPlan: taxYearRow.selected_plan_key || state.selectedPlan,
        selectedTransactionIds: [],
        transactionVisibleCount: 100,
        reportIncomeVisibleCount: 100,
        error: "",
        notice: options.silent ? state.notice : `${formatCount(normalizedTransactions.length)} saved rows loaded for ${taxYearRow.tax_year}.`,
      });
      return normalizedTransactions;
    } catch (error) {
      console.warn("Could not hydrate workspace data", error);
      if (!options.silent) setState({ error: error.message || "Could not load saved workspace data." });
      return null;
    } finally {
      if (workspaceHydrationKey === key) workspaceHydrationPromise = null;
    }
  })();
  return workspaceHydrationPromise;
}
function sanitizeStoredOpeningBalances(rows) {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows
    .map((row) => {
      const asset = String(rowValue(row, ["asset", "symbol", "asset_symbol", "coin", "currency"])).trim().toUpperCase();
      const quantity = parseNumberValue(rowValue(row, ["quantity", "amount", "total", "balance", "free"]));
      const averageCostSek = parseNumberValue(rowValue(row, ["averageCostSek", "average_cost_sek", "costSek", "cost_basis_sek"]));
      const priceUsd = parseNumberValue(rowValue(row, ["priceUsd", "price_usd", "priceUSD", "usdPrice"]));
      const valueUsd = parseNumberValue(rowValue(row, ["valueUsd", "value_usd", "valueUSD", "usdValue"]));
      const statementDate = String(rowValue(row, ["statementDate", "statement_date", "date"]) || "").slice(0, 10);
      return {
        asset,
        quantity,
        averageCostSek,
        priceUsd,
        valueUsd,
        statementDate,
        costBasisStatus: averageCostSek > 0 ? "provided" : "unknown",
      };
    })
    .filter((row) => row.asset && Number.isFinite(row.quantity) && row.quantity >= 0);
  if (cleaned.length !== rows.length) appStorage.setSession("openingBalances", cleaned);
  return cleaned;
}

function sanitizeStoredDiscovery(discovery) {
  if (!discovery || typeof discovery !== "object") return null;
  const taxYear = Number(discovery.taxYear);
  if (!Number.isInteger(taxYear)) return null;
  return {
    taxYear,
    status: String(discovery.status || "discovered"),
    checkedAt: discovery.checkedAt || "",
    source: discovery.source || "binance_account_snapshot",
    sourceLabel: discovery.sourceLabel || "Binance account snapshot",
    recordCount: Number(discovery.recordCount ?? discovery.availableRows ?? 0) || 0,
    recordCountVerified: Boolean(discovery.recordCountVerified),
    estimatedRows: Number(discovery.estimatedRows || 0) || 0,
    recommendedPlan: discovery.recommendedPlan || discovery.recommended_plan || "free",
    nonZeroAssets: Array.isArray(discovery.nonZeroAssets) ? discovery.nonZeroAssets.map((asset) => String(asset).toUpperCase()).slice(0, 80) : [],
    nonZeroAssetCount: Number(discovery.nonZeroAssetCount ?? discovery.non_zero_asset_count ?? discovery.nonZeroAssets?.length ?? 0) || 0,
    account: sanitizeDiscoveryAccount(discovery.account),
    yearEndStatements: sanitizeYearEndStatements(discovery.yearEndStatements),
    productCoverage: sanitizeProductCoverage(discovery.productCoverage),
    productAreasChecked: Number(discovery.productAreasChecked || discovery.productCoverage?.length || 0) || 0,
    productAreasFound: Number(discovery.productAreasFound || 0) || 0,
    message: discovery.message || "",
    canImportDirectly: Boolean(discovery.canImportDirectly),
  };
}

function sanitizeDiscoveryAccount(account) {
  if (!account || typeof account !== "object") return null;
  return {
    label: account.label || "",
    apiKeyHint: account.apiKeyHint || account.api_key_hint || "",
    uid: account.uid ? String(account.uid) : "",
    accountType: account.accountType || "SPOT",
    permissions: Array.isArray(account.permissions) ? account.permissions.map(String) : [],
    totalAssetCount: Number(account.totalAssetCount || 0) || 0,
    nonZeroAssetCount: Number(account.nonZeroAssetCount || 0) || 0,
    updateTime: account.updateTime || "",
    canTrade: Boolean(account.canTrade),
    canWithdraw: Boolean(account.canWithdraw),
    canDeposit: Boolean(account.canDeposit),
    brokered: Boolean(account.brokered),
    vipLevel: account.vipLevel ?? null,
    isMarginEnabled: account.isMarginEnabled ?? null,
    isFutureEnabled: account.isFutureEnabled ?? null,
    apiRestrictions: account.apiRestrictions && typeof account.apiRestrictions === "object" ? account.apiRestrictions : null,
  };
}

function sanitizeYearEndStatements(statements) {
  if (!Array.isArray(statements)) return [];
  return statements
    .map((statement) => ({
      year: Number(statement?.year),
      status: String(statement?.status || "missing"),
      message: statement?.message || "",
      snapshotAt: statement?.snapshotAt || "",
      totalAssetOfBtc: statement?.totalAssetOfBtc || "",
      nonZeroAssetCount: Number(statement?.nonZeroAssetCount || 0) || 0,
      assetCount: Number(statement?.assetCount || 0) || 0,
      topAssets: Array.isArray(statement?.topAssets) ? statement.topAssets.slice(0, 14) : [],
    }))
    .filter((statement) => Number.isInteger(statement.year));
}

function sanitizeProductCoverage(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    key: String(item?.key || ""),
    label: String(item?.label || item?.key || "Product"),
    group: String(item?.group || ""),
    status: String(item?.status || "unknown"),
    count: Number(item?.count || 0) || 0,
    sampled: Boolean(item?.sampled),
    message: String(item?.message || ""),
  }));
}

function sanitizeImportPreview(preview) {
  if (!preview || typeof preview !== "object") return null;
  const rowCount = Number(preview.rowCount || preview.row_count || 0) || 0;
  const workspaceRowCount = Number(preview.workspaceRowCount || preview.workspace_row_count || rowCount) || 0;
  const recommendedPlan = preview.recommendedPlan || preview.recommended_plan || {};
  const recommendedKey = recommendedPlan.key || recommendedPlan.plan_key || preview.planKey || "free";
  const catalogPlan = planCatalog.find((plan) => plan.key === recommendedKey);
  return {
    taxYear: Number(preview.taxYear || preview.tax_year || 0) || null,
    rowCount,
    workspaceRowCount,
    productSummaries: Array.isArray(preview.productSummaries) ? preview.productSummaries.map((item) => ({
      key: String(item?.key || ""),
      label: String(item?.label || item?.key || "Product"),
      status: String(item?.status || "unknown"),
      count: Number(item?.count || 0) || 0,
      message: String(item?.message || ""),
    })) : [],
    sampleRows: Array.isArray(preview.sampleRows) ? preview.sampleRows.slice(0, 8) : [],
    recommendedPlan: {
      key: recommendedKey,
      name: recommendedPlan.name || catalogPlan?.name || recommendedKey,
      description: recommendedPlan.description || "",
      priceAmount: Number(recommendedPlan.priceAmount ?? recommendedPlan.price_amount ?? 0) || 0,
      currency: recommendedPlan.currency || "sek",
      maxTransactions: Number(recommendedPlan.maxTransactions ?? recommendedPlan.max_transactions ?? 0) || 0,
      includesAiRecovery: Boolean(recommendedPlan.includesAiRecovery ?? recommendedPlan.includes_ai_recovery),
    },
    requiresPayment: Boolean(preview.requiresPayment || preview.requires_payment),
    capped: Boolean(preview.capped),
    overLimit: Boolean(preview.overLimit || preview.over_limit),
    checkedAt: preview.checkedAt || preview.checked_at || new Date().toISOString(),
  };
}

function navTemplate(context = "desktop") {
  const buttonClass = context === "mobile" ? "mobile-nav-button" : "nav-button";
  return navItems
    .map(
      (item) => `
      <button class="${buttonClass} ${state.route === item.route ? "is-active" : ""}" type="button" data-route="${item.route}">
        <span class="nav-icon">${item.icon}</span>
        <span>${t(item.labelKey)}</span>
      </button>
    `,
    )
    .join("");
}

function shellTemplate() {
  const summary = summarizeTransactions(selectedYearTransactions());
  const importedYearCount = selectedYearImportedTransactions().length;
  const workspaceCount = Array.isArray(state.transactions) ? state.transactions.length : 0;
  const includedTransactionSlots = workspaceTransactionSlots();
  const capacityOverLimit = includedTransactionSlots > 0 && workspaceCount > includedTransactionSlots;
  return `
    <div class="shell">
      <aside class="sidebar">
        ${brandTemplate()}
        <nav class="nav" aria-label="Main navigation">${navTemplate()}</nav>
        <div class="sidebar-footer">
          <div class="status-card">
            <strong>${escapeHtml(state.connection.label)}</strong>
            <span>${state.connection.status === "connected" ? t("readyForDiscovery") : t("connectBinance")}</span>
          </div>
          <div class="status-card">
            <strong>${formatSek(summary.gain + summary.income)}</strong>
            <span>${t("taxableResult")}</span>
          </div>
        </div>
      </aside>
      ${mobileDrawerTemplate()}
      <main class="main">
        <header class="topbar">
          <button class="mobile-menu-toggle" type="button" data-action="toggle-mobile-nav" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded="${state.mobileOpen ? "true" : "false"}">
            ${icons.menu}
          </button>
          <div class="topbar-title">
            <strong>${routeTitle()}</strong>
            <span>${state.auth.user ? escapeHtml(state.auth.user.email || t("signedIn")) : t("secureSignIn")}</span>
          </div>
          <div class="topbar-actions">
            <div class="topbar-transaction-count ${capacityOverLimit ? "is-over-limit" : ""}" title="${escapeHtml(t("uploadedSlotsTitle"))}">
              <strong>${formatCount(workspaceCount)} / ${formatCount(includedTransactionSlots)}</strong>
              <span>${formatCount(importedYearCount)} ${t("inYear")} ${state.selectedTaxYear}</span>
            </div>
            <div class="topbar-year-control">
              <select aria-label="Tax year" data-field="selected-tax-year">
                ${taxYears.map((year) => `<option value="${year}" ${Number(state.selectedTaxYear) === year ? "selected" : ""}>${t("taxYear")} ${year}</option>`).join("")}
              </select>
            </div>
            ${themeToggleTemplate("desktop")}
            <button class="btn btn-secondary" type="button" data-route="account">${state.auth.user ? t("account") : t("signIn")}</button>
          </div>
        </header>
        ${state.route === "dashboard" ? dashboardTemplate() : ""}
        <div class="content">
          ${noticeTemplate()}
          ${state.route === "import" || state.route === "binance" ? binanceTemplate() : ""}
          ${state.route === "ai-import" ? aiImportTemplate() : ""}
          ${state.route === "transactions" ? transactionsTemplate() : ""}
          ${state.route === "reports" ? reportsTemplate() : ""}
          ${state.route === "billing" ? billingTemplate() : ""}
          ${state.route === "account" ? accountTemplate() : ""}
        </div>
        ${state.auth.user ? compactWorkflowTemplate("bottom") : ""}
      </main>
      ${state.loading ? loaderTemplate() : ""}
    </div>
  `;
}

function appTemplate() {
  if (state.auth.status === "idle" || state.auth.status === "loading") {
    return authLoadingTemplate();
  }
  if (!state.auth.user) {
    return publicLandingTemplate();
  }
  return shellTemplate();
}

function publicLandingTemplate() {
  return `
    <main class="public-page">
      <header class="public-header">
        ${brandTemplate()}
        <nav class="public-nav public-nav-desktop" aria-label="${t("publicNav")}">
          <a href="#csv-ai">CSV AI</a>
          <a href="#workflow">${t("workflow")}</a>
          <a href="#pricing">${t("pricing")}</a>
          ${themeToggleTemplate("desktop")}
          <button class="btn btn-secondary" type="button" data-action="focus-auth-signin">${t("signIn")}</button>
        </nav>
        <button class="public-menu-toggle" type="button" data-action="toggle-mobile-nav" aria-label="${t("openMenu")}" aria-controls="public-mobile-navigation" aria-expanded="${state.mobileOpen ? "true" : "false"}">
          ${icons.menu}
        </button>
      </header>
      ${publicMobileDrawerTemplate()}

      <section class="public-hero">
        <div class="public-hero-copy">
          <p class="eyebrow">CryptoTax Sweden</p>
          <h1>${t("cryptoTaxHero")}</h1>
          <p class="lead">${t("cryptoTaxLead")}</p>
          <div class="public-hero-proof" aria-label="${t("coreStrengths")}">
            <span>${t("binanceApiImport")}</span>
            <span>${t("aiCsvClassification")}</span>
            <span>${t("k4Output")}</span>
          </div>
          <div class="button-row">
            <button class="btn btn-primary" type="button" data-action="focus-auth-signup">${t("createAccount")}</button>
            <a class="btn btn-secondary" href="#pricing">${t("viewPricing")}</a>
          </div>
        </div>
        <div class="public-hero-media">
          <div class="public-product-preview" aria-label="${t("signedInWorkspace")}">
            <img src="assets/app-preview.png" alt="${t("appPreviewAlt")}" loading="eager" />
            <div class="public-product-caption">
              <strong>${t("signedInWorkspace")}</strong>
              <span>${t("signedInWorkspaceHelp")}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="csv-ai" class="public-section public-usp-grid" aria-label="${t("coreStrengths")}">
        <article class="card public-usp-card">
          <h3>${t("aiReadsCsv")}</h3>
          <p class="muted">${t("aiReadsCsvHelp")}</p>
        </article>
        <article class="card public-usp-card">
          <h3>${t("sekTrailTitle")}</h3>
          <p class="muted">${t("sekTrailHelp")}</p>
        </article>
        <article class="card public-usp-card">
          <h3>${t("k4IncomeApart")}</h3>
          <p class="muted">${t("k4IncomeApartHelp")}</p>
        </article>
      </section>

      <section id="workflow" class="public-section">
        <div class="section-heading">
          <p class="eyebrow">${t("workflow")}</p>
          <h2>${t("workflowHeadline")}</h2>
        </div>
        <div class="grid grid-4">
          ${workflowSteps
            .map(
              (step, index) => `
                <article class="card">
                  <div class="workflow-index">${index + 1}</div>
                  <h3>${escapeHtml(step.title)}</h3>
                  <p class="small muted">${escapeHtml(step.detail)}</p>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section id="pricing" class="public-section">
        <div class="section-heading">
          <p class="eyebrow">${t("pricing")}</p>
          <h2>${t("pricingHeadline")}</h2>
          <p class="muted">${t("pricingHelp")}</p>
        </div>
        <div class="grid grid-4">
          ${planCatalog.map(publicPlanCardTemplate).join("")}
        </div>
      </section>

      <section id="signin" class="public-section public-auth-section">
        <div class="section-heading">
          <p class="eyebrow">${t("secureAccess")}</p>
          <h2>${t("startSecurely")}</h2>
          <p class="muted">${t("secureAccessHelp")}</p>
        </div>
        <div class="public-auth-panel">
          ${noticeTemplate()}
          ${authTemplate()}
        </div>
      </section>
      ${state.loading ? loaderTemplate() : ""}
    </main>
  `;
}

function publicMobileDrawerTemplate() {
  return `
    <div id="public-mobile-navigation" class="mobile-drawer public-mobile-drawer ${state.mobileOpen ? "is-open" : ""}">
      <button class="mobile-drawer-backdrop" type="button" data-action="close-mobile-nav" aria-label="${t("closeMenu")}"></button>
      <div class="mobile-drawer-panel">
        ${brandTemplate()}
        ${themeToggleTemplate("mobile")}
        <nav class="public-mobile-nav" aria-label="${t("publicMobileNav")}">
          <a class="mobile-nav-button public-mobile-link" href="#csv-ai" data-action="close-mobile-nav">CSV AI</a>
          <a class="mobile-nav-button public-mobile-link" href="#workflow" data-action="close-mobile-nav">${t("workflow")}</a>
          <a class="mobile-nav-button public-mobile-link" href="#pricing" data-action="close-mobile-nav">${t("pricing")}</a>
          <button class="mobile-nav-button public-mobile-link" type="button" data-action="focus-auth-signup">${t("createAccount")}</button>
          <button class="mobile-nav-button public-mobile-link" type="button" data-action="focus-auth-signin">${t("signIn")}</button>
        </nav>
      </div>
    </div>
  `;
}

function publicPlanCardTemplate(plan) {
  return `
    <article class="plan-card public-plan-card">
      <span class="badge ${plan.key === "starter" ? "badge-yellow" : "badge-blue"}">${escapeHtml(plan.badge)}</span>
      <h3>${escapeHtml(plan.name)}</h3>
      <div class="plan-price">${formatMinorSek(plan.priceAmount)}</div>
      <p class="small muted">${plan.includesAiRecovery ? escapeHtml(tr("transactionsAiReview", { count: plan.maxTransactions.toLocaleString("sv-SE") })) : escapeHtml(tr("transactionsPlain", { count: plan.maxTransactions.toLocaleString("sv-SE") }))}</p>
      <button class="btn btn-secondary" type="button" data-action="focus-auth-signup">${t("getStarted")}</button>
    </article>
  `;
}

function authGateTemplate() {
  return `
    <main class="auth-gate">
      <section class="auth-gate-copy">
        ${brandTemplate()}
        <div>
          <p class="eyebrow">${t("privateWorkspace")}</p>
          <h1>${t("authGateTitle")}</h1>
          <p class="lead">${t("authGateHelp")}</p>
        </div>
      </section>
      <section class="auth-gate-panel">
        ${noticeTemplate()}
        ${authTemplate()}
      </section>
      ${state.loading ? loaderTemplate() : ""}
    </main>
  `;
}

function authLoadingTemplate() {
  return `
    <main class="auth-loading-shell" role="status" aria-busy="true">
      <div class="loader-box">
        <div class="loader-pulse" aria-hidden="true"></div>
        <h1>${t("checkingSignIn")}</h1>
        <p class="muted">${t("restoringSession")}</p>
      </div>
    </main>
  `;
}

function brandTemplate() {
  return `
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">CT</div>
      <div class="wordmark">CryptoTax <span>Sweden</span></div>
    </div>
  `;
}

function themeToggleTemplate(context = "desktop") {
  const isDark = state.theme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  return `
    <button class="theme-toggle theme-toggle-${context}" type="button" data-action="toggle-theme" aria-label="${escapeHtml(tr("switchTheme", { theme: nextTheme }))}" aria-pressed="${isDark ? "true" : "false"}">
      <span class="theme-toggle-track" aria-hidden="true">
        <span class="theme-toggle-dot"></span>
      </span>
      <span class="theme-toggle-label">${isDark ? t("dark") : t("light")}</span>
    </button>
  `;
}

function mobileDrawerTemplate() {
  return `
    <div id="mobile-navigation" class="mobile-drawer ${state.mobileOpen ? "is-open" : ""}">
      <button class="mobile-drawer-backdrop" type="button" data-action="close-mobile-nav" aria-label="Close navigation"></button>
      <div class="mobile-drawer-panel">
        ${brandTemplate()}
        ${themeToggleTemplate("mobile")}
        <nav class="nav" aria-label="Mobile navigation">${navTemplate("mobile")}</nav>
      </div>
    </div>
  `;
}

function routeTitle() {
  const found = navItems.find((item) => item.route === state.route);
  return found ? t(found.labelKey) : t("dashboard");
}

function noticeTemplate() {
  return `
    ${state.error ? `<div class="alert alert-error section">${escapeHtml(state.error)}</div>` : ""}
    ${state.notice ? `<div class="alert alert-success section">${escapeHtml(state.notice)}</div>` : ""}
  `;
}

function infoPopoverTemplate(text) {
  return `
    <details class="info-popover">
      <summary aria-label="More information">i</summary>
      <p>${escapeHtml(text)}</p>
    </details>
  `;
}

function dashboardTemplate() {
  const connectionLabel =
    state.connection.status === "connected" ? state.connection.label || "Binance connected" : "No Binance connection";
  const transactions = selectedYearTransactions();
  const summary = summarizeTransactions(transactions);
  const discovery = selectedYearDiscovery();
  const csvRows = transactions.filter((row) => transactionSourceDisplay(row) !== "Binance").length;
  const taxEstimate = Math.max(0, summary.gain) * 0.3 + summary.income * 0.3;
  const report = selectedYearReport();
  return `
    <div class="content dashboard-content">
      ${noticeTemplate()}
      <section class="section dashboard-header dashboard-header-compact">
        <div>
          <p class="eyebrow">${t("taxYearWorkspace")}</p>
          <h1 class="dashboard-title">${t("taxYear")} ${escapeHtml(state.selectedTaxYear)}</h1>
          <p class="muted">${escapeHtml(connectionLabel)}. ${t("reviewWorkspace")}</p>
        </div>
        <div class="button-row dashboard-actions">
          <button class="btn btn-secondary" type="button" data-route="billing">${t("pricing")}</button>
        </div>
      </section>
      <section class="section grid grid-2 dashboard-overview-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <h2>${t("dataOverview")}</h2>
              <p class="muted">${t("dataOverviewHelp")}</p>
            </div>
            <span class="badge">${summary.count ? t("loaded") : t("empty")}</span>
          </div>
          <div class="dashboard-summary">
            <div class="metric"><span>${t("binanceDiscovery")}</span><strong>${discovery ? `${formatCount(discovery.productAreasFound || 0)}/${formatCount(discovery.productAreasChecked || 0)}` : t("notRun")}</strong></div>
            <div class="metric"><span>${t("importedRows")}</span><strong>${formatCount(summary.count)}</strong></div>
            <div class="metric"><span>${t("csvRows")}</span><strong>${formatCount(csvRows)}</strong></div>
            <div class="metric"><span>${t("report")}</span><strong>${report ? t("generated") : t("draft")}</strong></div>
          </div>
          <div class="button-row dashboard-actions-inline">
            <button class="btn btn-secondary" type="button" data-route="binance">${t("binance")}</button>
            <button class="btn btn-secondary" type="button" data-route="ai-import">${t("csvImport")}</button>
            <button class="btn btn-secondary" type="button" data-route="transactions">${t("transactions")}</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <h2>${t("taxDraft")}</h2>
              <p class="muted">${t("taxDraftHelp")}</p>
            </div>
            <span class="badge">${formatSek(taxEstimate)}</span>
          </div>
          <div class="dashboard-summary">
            <div class="metric"><span>${t("k4Result")}</span><strong>${formatSek(summary.gain)}</strong></div>
            <div class="metric"><span>${t("otherIncome")}</span><strong>${formatSek(summary.income)}</strong></div>
            <div class="metric"><span>${t("estimatedTax")}</span><strong>${formatSek(taxEstimate)}</strong></div>
            <div class="metric"><span>${t("rowsReviewed")}</span><strong>${formatCount(summary.count)}</strong></div>
          </div>
          <div class="button-row dashboard-actions-inline">
            <button class="btn btn-primary" type="button" data-route="reports">${t("openReport")}</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function dashboardNextAction() {
  const discovery = selectedYearDiscovery();
  const preview = selectedYearImportPreview();
  const transactions = selectedYearTransactions();
  const report = selectedYearReport();
  if (state.connection.status !== "connected") {
    return {
      title: "Connect Binance",
      detail: "Connect a read-only Binance Tax API key before scanning account activity.",
      button: "Connect Binance",
      route: "binance",
      badge: "Needed",
      badgeClass: "badge-yellow",
    };
  }
  if (!discovery) {
    return {
      title: "Scan Binance",
      detail: "Run discovery to see which Binance product areas have activity for this tax year.",
      button: "Run discovery",
      action: "start-discovery",
      badge: "Ready",
      badgeClass: "badge-blue",
      secondaryRoute: "binance",
      secondaryLabel: "Open Binance",
    };
  }
  if (!preview) {
    return {
      title: "Import Binance transactions",
      detail: "Open the transaction view to fetch Binance rows and review what will be imported.",
      button: "Open transactions",
      route: "transactions",
      badge: "Ready",
      badgeClass: "badge-blue",
      secondaryRoute: "binance",
      secondaryLabel: "Open Binance",
    };
  }
  if (!transactions.length) {
    return {
      title: preview.requiresPayment ? "Pay the selected package" : "Import API rows",
      detail: preview.requiresPayment
        ? `${formatCount(preview.workspaceRowCount || preview.rowCount)} total workspace rows. The selected package is ${preview.recommendedPlan.name}.`
        : `${formatCount(preview.workspaceRowCount || preview.rowCount)} total workspace rows can be imported now.`,
      button: preview.requiresPayment ? `Pay ${formatMinorSek(preview.recommendedPlan.priceAmount)}` : "Import from Binance API",
      action: preview.requiresPayment ? "checkout" : "import-api-tax-year",
      badge: preview.requiresPayment ? "Payment" : "Ready",
      badgeClass: preview.requiresPayment ? "badge-yellow" : "badge-blue",
      secondaryRoute: "transactions",
      secondaryLabel: "Review preview",
    };
  }
  if (!report) {
    return {
      title: "Generate the tax report",
      detail: `${formatCount(transactions.length)} rows are imported. Generate the Swedish tax output when review is complete.`,
      button: "Open reports",
      route: "reports",
      badge: "Ready",
      badgeClass: "badge-blue",
    };
  }
  return {
    title: "Review the report",
    detail: "The current report draft is ready for review and handoff.",
    button: "Open report",
    route: "reports",
    badge: "Done",
    badgeClass: "",
  };
}

function workflowStepsForYear() {
  const discovery = selectedYearDiscovery();
  const preview = selectedYearImportPreview();
  const transactions = selectedYearTransactions();
  const report = selectedYearReport();
  const csvDraft = state.aiImport || null;
  const hasCsvRows = transactions.some((row) => transactionSourceDisplay(row) !== "Binance");
  return [
    {
      route: "binance",
      number: 1,
      title: t("binance"),
      longTitle: t("binance"),
      detail: discovery ? tr("productAreasReturned", { found: formatCount(discovery.productAreasFound || 0), checked: formatCount(discovery.productAreasChecked || 0) }) : t("connectApiRunDiscovery"),
      status: discovery ? "done" : state.connection.status === "connected" ? "ready" : "todo",
    },
    {
      route: "ai-import",
      number: 2,
      title: t("csvImport"),
      longTitle: t("importOtherCsv"),
      detail: hasCsvRows ? t("csvRowsImported") : csvDraft ? tr("csvRowsMapped", { count: formatCount(aiImportIncludedRows(csvDraft).length) }) : t("optionalWalletCsv"),
      status: hasCsvRows ? "done" : csvDraft ? "ready" : "todo",
    },
    {
      route: "transactions",
      number: 3,
      title: t("transactions"),
      longTitle: t("reviewTransactions"),
      detail: transactions.length ? tr("transactionRowsImported", { count: formatCount(transactions.length) }) : preview ? tr("workspaceRowsPriced", { count: formatCount(preview.workspaceRowCount || preview.rowCount) }) : t("countApiRows"),
      status: transactions.length ? "done" : preview || discovery ? "ready" : "todo",
    },
    {
      route: "reports",
      number: 4,
      title: t("report"),
      longTitle: t("reviewTaxOutput"),
      detail: report ? t("reportDraftReady") : t("recoverGenerateK4"),
      status: report ? "done" : transactions.length ? "ready" : "todo",
    },
  ];
}

function compactWorkflowTemplate(placement = "topbar") {
  const steps = workflowStepsForYear();
  return `
    <nav class="${placement === "bottom" ? "bottom-workflow" : "topbar-workflow"}" aria-label="Tax year workflow">
      ${steps
        .map(
          (step) => `
            <button class="topbar-step ${state.route === step.route ? "is-active" : ""} topbar-step-${step.status}" type="button" data-route="${step.route}" title="${escapeHtml(step.detail)}">
              <span>${step.number}</span>
              <strong>${escapeHtml(step.title)}</strong>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function workflowChecklistTemplate(activeRoute = state.route) {
  const steps = workflowStepsForYear();
  return `
    <div class="workflow-checklist">
      ${steps
        .map(
          (step) => `
            <button class="workflow-step ${activeRoute === step.route ? "is-active" : ""} workflow-step-${step.status}" type="button" data-route="${step.route}">
              <span class="workflow-step-number">${step.number}</span>
              <span class="workflow-step-copy">
                <strong>${escapeHtml(step.longTitle || step.title)}</strong>
                <small>${escapeHtml(step.detail)}</small>
              </span>
              <span class="badge ${step.status === "done" ? "" : step.status === "ready" ? "badge-blue" : "badge-yellow"}">${escapeHtml(step.badge || step.status)}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function binanceTemplate() {
  const discovery = selectedYearDiscovery();
  const hasConnection = state.connection.status === "connected";
  const connectionLabelValue = hasConnection ? state.connection.label || t("mainBinance") : t("mainBinance");
  const csvDisabled = discovery ? "" : "disabled";
  return `
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("binanceConnection")}</h2>
            <p class="muted">${t("binanceConnectionHelp")}</p>
          </div>
          <span class="badge ${hasConnection ? "" : "badge-blue"}">${escapeHtml(state.connection.status)}</span>
        </div>
        ${binanceConnectionControls(hasConnection, connectionLabelValue)}
      </div>
    </section>
    <section class="section">${discoveryTemplate(discovery)}</section>
    <section class="section">
      <details class="card accordion-card">
        <summary>
          <span>
            <strong>${t("csvFallback")}</strong>
            <small>${t("csvFallbackHelp")}</small>
          </span>
          <span class="badge badge-blue">${t("manual")}</span>
        </summary>
        <form class="form-grid" data-form="tax-import">
          <div class="form-row">
            <label for="transaction-file">${t("binanceTransactionCsv")}</label>
            <input id="transaction-file" name="transactionFile" type="file" accept=".csv,text/csv" ${csvDisabled} />
          </div>
          <div class="button-row form-actions-inline">
            <button class="btn btn-secondary" type="submit" ${csvDisabled}>${t("importCsvFallbackRows")}</button>
          </div>
        </form>
      </details>
    </section>
  `;
}

function statementTemplate() {
  const statementDate = yearStartStatementDate();
  const openingCount = selectedYearOpeningBalances().length;
  return `
    <section class="section">
      <div class="card card-compact">
        <div class="card-header">
          <div>
            <h2>Year-start statement</h2>
            <p class="muted">Upload the Binance account statement from ${escapeHtml(statementDate)}. It proves starting quantities for tax year ${escapeHtml(state.selectedTaxYear)}.</p>
          </div>
          <span class="badge">${openingCount ? `${formatCount(openingCount)} rows` : "Required"}</span>
        </div>
        <form class="form-grid" data-form="opening">
          <input name="statementDate" type="hidden" value="${escapeHtml(statementDate)}" />
          <div class="form-row">
            <label for="opening-file">Statement PDF or CSV</label>
            <input id="opening-file" name="openingFile" type="file" accept=".pdf,application/pdf,.csv,text/csv" />
          </div>
          <div class="button-row form-actions-inline">
            <button class="btn btn-primary" type="submit">Extract statement rows</button>
          </div>
        </form>
        <p class="small muted">PDF statements are read with AI and must be reviewed before saving. Statement USD values are evidence only, never acquisition cost basis.</p>
      </div>
    </section>
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Statement review</h2>
            <p class="muted">Review extracted rows before saving them as the year-start snapshot.</p>
          </div>
          <span class="badge">${openingCount ? `${formatCount(openingCount)} rows` : "No rows"}</span>
        </div>
        ${statementPreviewTemplate() || `<div class="empty-state"><h3>No statement rows yet</h3><p class="muted">Upload a PDF or CSV statement file above.</p></div>`}
      </div>
    </section>
  `;
}

function transactionsTemplate() {
  const transactions = selectedYearTransactions();
  const filteredTransactions = filteredTransactionsForView(transactions);
  const totalCount = transactions.length;
  const filteredCount = filteredTransactions.length;
  const missingValuationRows = transactions.filter((item) => !transactionHasValuation(item));
  const missingValuationCount = missingValuationRows.length;
  return `
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("importedTransactions")}</h2>
            <p class="muted">${escapeHtml(tr("importedTransactionsHelp", { year: state.selectedTaxYear }))}</p>
          </div>
          <span class="badge">${formatCount(filteredCount)} / ${formatCount(totalCount)} ${t("rows")}</span>
        </div>
        ${transactionValuationNoticeTemplate(missingValuationRows, totalCount)}
        ${transactionFiltersTemplate(transactions)}
        ${transactionTableTemplate(false, filteredTransactions)}
      </div>
    </section>
  `;
}

function transactionValuationNoticeTemplate(missingRows, totalCount) {
  if (!totalCount || !missingRows.length) return "";
  const assets = [...new Set(missingRows.map((item) => String(item.asset || item.asset_symbol || "").toUpperCase()).filter(Boolean))].sort();
  return `
    <div class="alert transaction-valuation-alert">
      <div>
        <strong>${escapeHtml(tr("rowsNeedManualSekPrice", { count: formatCount(missingRows.length) }))}</strong>
        <p class="small muted">${
          assets.length
            ? `${escapeHtml(tr(assets.length === 1 ? "missingPricingOne" : "missingPricingMany", { assets: assets.join(", ") }))} ${t("refreshOrManualPrices")}`
            : `${t("missingPricingSome")} ${t("refreshOrManualPrices")}`
        }</p>
        ${assets.length ? `<div class="chip-row missing-price-coins">${assets.map((asset) => `<span class="badge badge-yellow">${escapeHtml(asset)}</span>`).join("")}</div>` : ""}
      </div>
      <button class="btn btn-secondary" type="button" data-route="binance">${t("openBinance")}</button>
    </div>
  `;
}

function aiImportTemplate() {
  const draft = state.aiImport || null;
  const includedRows = aiImportIncludedRows(draft);
  const sampleRows = includedRows.slice(0, 30);
  const hasIncludedRows = Boolean(draft && includedRows.length);
  const csvHistory = csvImportHistoryGroups();
  return `
    <section class="section grid grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("csvTransactionImport")}</h2>
            <p class="muted">${t("csvTransactionImportHelp")}</p>
          </div>
          <span class="badge">${draft ? t("previewReady") : "CSV"}</span>
        </div>
        <form class="form-grid" data-form="ai-import">
          <div class="form-row">
            <label for="ai-source-name">${t("sourceName")}</label>
            <input id="ai-source-name" name="sourceName" placeholder="Abra, Coinbase, wallet..." />
          </div>
          <div class="form-row">
            <label for="ai-csv-file">${t("csvFile")}</label>
            <input id="ai-csv-file" name="csvFile" type="file" accept=".csv,text/csv" />
          </div>
          <button class="btn btn-primary" type="submit">${t("analyzeCsv")}</button>
        </form>
      </div>
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("mappingPreview")}</h2>
            <p class="muted">${draft ? escapeHtml(tr("mappedRowsSelected", { selected: formatCount(includedRows.length), total: formatCount(draft.normalizedCount || 0) })) : t("noCsvAnalyzed")}</p>
          </div>
          <span class="badge">${draft ? `${Math.round(Number(draft.confidence || 0) * 100)}%` : t("waiting")}</span>
        </div>
        ${draft ? aiImportMappingTemplate(draft) : `<div class="empty-state"><h3>${t("noPreview")}</h3><p class="muted">${t("uploadCsvToMap")}</p></div>`}
      </div>
    </section>
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("rowsToImport")}</h2>
            <p class="muted">${t("rowsToImportHelp")}</p>
          </div>
          ${draft ? `<button class="btn btn-primary" type="button" data-action="approve-ai-import" ${hasIncludedRows ? "" : "disabled"}>${t("approveImport")}</button>` : ""}
        </div>
        ${draft ? aiImportAssetFilterTemplate(draft) : ""}
        ${sampleRows.length ? aiImportRowsTableTemplate(sampleRows) : `<div class="empty-state"><h3>${t("noRowsYet")}</h3><p class="muted">${t("previewRowsHere")}</p></div>`}
      </div>
    </section>
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("previousCsvImports")}</h2>
            <p class="muted">${t("previousCsvImportsHelp")}</p>
          </div>
          <span class="badge">${formatCount(csvHistory.reduce((sum, item) => sum + item.rows.length, 0))} ${t("rows")}</span>
        </div>
        ${csvHistory.length ? csvImportHistoryTemplate(csvHistory) : `<div class="empty-state"><h3>${t("noCsvImportsYet")}</h3><p class="muted">${t("approvedCsvImportsAppear")}</p></div>`}
      </div>
    </section>
  `;
}

function aiImportMappingTemplate(draft) {
  const mapping = draft.mapping || {};
  const mappingRows = Object.entries(mapping).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  return `
    <div class="detail-grid">
      <div class="metric"><span>${t("sourceName")}</span><strong>${escapeHtml(draft.sourceName || "AI CSV")}</strong></div>
      <div class="metric"><span>${t("file")}</span><strong>${escapeHtml(draft.fileName || "CSV")}</strong></div>
      <div class="metric"><span>${t("rowCount")}</span><strong>${formatCount(draft.normalizedCount || 0)} / ${formatCount(draft.rowCount || 0)}</strong></div>
      <div class="metric"><span>${t("selected")}</span><strong>${formatCount(aiImportIncludedRows(draft).length)}</strong></div>
      <div class="metric"><span>${t("taxYear")}</span><strong>${escapeHtml(state.selectedTaxYear)}</strong></div>
    </div>
    ${warnings.length ? `<div class="alert"><strong>${t("reviewWarnings")}</strong><p class="small muted">${warnings.map(escapeHtml).join(" ")}</p></div>` : ""}
    <details class="mapping-details">
      <summary>${t("columnMapping")}</summary>
      <div class="mapping-chip-grid">
        ${mappingRows.slice(0, 16).map(([key, value]) => `
          <div class="mapping-chip">
            <span>${escapeHtml(key)}</span>
            <strong>${escapeHtml(String(value))}</strong>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function aiImportAssetFilterTemplate(draft) {
  const assets = aiImportAssetOptions(draft);
  if (!assets.length) return "";
  const excluded = aiImportExcludedAssets(draft);
  return `
    <div class="subsection">
      <h3>${t("coinsToInclude")}</h3>
      <div class="asset-toggle-grid">
        ${assets.map(({ asset, count }) => {
          const checked = !excluded.has(asset);
          return `
            <label class="asset-toggle ${checked ? "is-selected" : ""}">
              <input type="checkbox" data-field="ai-import-asset" value="${escapeHtml(asset)}" ${checked ? "checked" : ""} />
              <span>${escapeHtml(asset)}</span>
              <small>${formatCount(count)} ${t("rows")}</small>
            </label>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function aiImportExcludedAssets(draft = state.aiImport) {
  return new Set((Array.isArray(draft?.excludedAssets) ? draft.excludedAssets : []).map((asset) => String(asset).toUpperCase()));
}

function aiImportAssetOptions(draft = state.aiImport) {
  const counts = new Map();
  const rows = Array.isArray(draft?.normalizedRows) ? draft.normalizedRows : [];
  rows.forEach((row) => {
    const asset = String(row.asset || row.asset_symbol || "").toUpperCase();
    if (!asset) return;
    counts.set(asset, (counts.get(asset) || 0) + 1);
  });
  return [...counts.entries()].map(([asset, count]) => ({ asset, count })).sort((a, b) => a.asset.localeCompare(b.asset));
}

function aiImportIncludedRows(draft = state.aiImport) {
  const excluded = aiImportExcludedAssets(draft);
  const rows = Array.isArray(draft?.normalizedRows) ? draft.normalizedRows : [];
  return rows.filter((row) => {
    const asset = String(row.asset || row.asset_symbol || "").toUpperCase();
    return !asset || !excluded.has(asset);
  });
}

function aiImportRowsTableTemplate(rows) {
  return `
    <div class="table-wrap ai-import-table-wrap">
      <table>
        <thead><tr><th>${t("date")}</th><th>${t("type")}</th><th>${t("asset")}</th><th>${t("quantity")}</th><th>${t("sekPerUnit")}</th><th>${t("income")} SEK</th><th>${t("proceeds")}</th><th>${t("costBasis")}</th><th>${t("notes")}</th><th>${t("confidence")}</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td data-label="${t("date")}">${formatDate(row.date || row.traded_at)}</td>
              <td data-label="${t("type")}">${escapeHtml(formatTransactionType(row.type || "transaction"))}</td>
              <td data-label="${t("asset")}">${escapeHtml(row.asset || row.asset_symbol || "")}</td>
              <td data-label="${t("quantity")}">${formatQuantity(row.quantity || 0)}</td>
              <td data-label="${t("sekPerUnit")}">${formatCsvSekValue(row.priceSek || row.price_sek || 0)}</td>
              <td data-label="${t("income")} SEK">${formatCsvSekValue(row.incomeSek || row.income_sek || 0)}</td>
              <td data-label="${t("proceeds")}">${formatCsvSekValue(row.proceedsSek || row.proceeds_sek || 0)}</td>
              <td data-label="${t("costBasis")}">${formatCsvSekValue(row.costSek || row.cost_basis_sek || 0)}</td>
              <td data-label="${t("notes")}">${escapeHtml(row.notes || "")}</td>
              <td data-label="${t("confidence")}">${formatConfidence(row.confidence || 0.72)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function csvImportHistoryGroups() {
  const rows = selectedYearTransactions().filter(isCsvImportTransaction);
  const groups = new Map();
  for (const row of rows) {
    const meta = csvImportMeta(row);
    const key = meta.batchId || `${meta.sourceName}:${meta.fileName}:${meta.importedAt || ""}`;
    const group = groups.get(key) || {
      key,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      importedAt: meta.importedAt,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      firstDate: group.rows.reduce((min, row) => {
        const value = String(row.date || row.traded_at || "");
        return !min || (value && value < min) ? value : min;
      }, ""),
      lastDate: group.rows.reduce((max, row) => {
        const value = String(row.date || row.traded_at || "");
        return !max || (value && value > max) ? value : max;
      }, ""),
      incomeSek: group.rows.reduce((sum, row) => sum + transactionIncomeSek(row), 0),
      valueSek: group.rows.reduce((sum, row) => sum + transactionEstimatedValueSek(row), 0),
    }))
    .sort((left, right) => String(right.importedAt || right.lastDate || "").localeCompare(String(left.importedAt || left.lastDate || "")));
}

function isCsvImportTransaction(row) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === "object" ? raw.raw : raw;
  const source = String(transactionSourceRaw(row) || "").toLowerCase();
  const displaySource = String(transactionSourceDisplay(row) || "").toLowerCase();
  const combinedSource = `${source} ${displaySource}`.trim();
  const knownCsvSource =
    combinedSource &&
    !combinedSource.includes("binance") &&
    !combinedSource.includes("imported") &&
    displaySource !== "unknown";
  return Boolean(
    source.includes("ai_csv") ||
      source.includes("binance_csv") ||
      source.includes("csv import") ||
      displaySource.includes("csv import") ||
      knownCsvSource ||
      raw.csvImport ||
      nestedRaw.csvImport ||
      nestedRaw.aiMapping ||
      nestedRaw.csvRow,
  );
}

function csvImportMeta(row) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === "object" ? raw.raw : raw;
  const csvImport = raw.csvImport && typeof raw.csvImport === "object"
    ? raw.csvImport
    : nestedRaw.csvImport && typeof nestedRaw.csvImport === "object"
      ? nestedRaw.csvImport
      : {};
  return {
    batchId: String(csvImport.batchId || raw.importBatchId || nestedRaw.importBatchId || ""),
    sourceName: String(csvImport.sourceName || raw.sourceName || raw.source_name || nestedRaw.sourceName || nestedRaw.source_name || transactionSourceDisplay(row) || "CSV Import"),
    fileName: String(csvImport.fileName || raw.fileName || nestedRaw.fileName || `${csvImport.sourceName || raw.sourceName || nestedRaw.sourceName || transactionSourceDisplay(row) || "CSV"} file`),
    importedAt: String(csvImport.importedAt || raw.importedAt || nestedRaw.importedAt || ""),
  };
}

function csvImportHistoryTemplate(groups) {
  return `
    <div class="csv-import-history">
      ${groups.map((group, index) => `
        <details class="csv-import-history-row" ${index === 0 ? "open" : ""}>
          <summary>
            <div class="statement-main">
              <strong>${escapeHtml(group.sourceName)}</strong>
              <span class="muted">${escapeHtml(group.fileName)}${group.importedAt ? ` - ${escapeHtml(formatDate(group.importedAt))}` : ""}</span>
            </div>
            <div class="csv-import-history-meta">
              <span>${formatCount(group.rows.length)} rows</span>
              <span>${group.incomeSek ? `${formatSek(group.incomeSek)} income` : `${formatSek(group.valueSek)} value`}</span>
            </div>
          </summary>
          <div class="csv-import-history-body">
            <div class="summary-strip discovery-strip">
              <div class="metric"><span>Rows</span><strong>${formatCount(group.rows.length)}</strong></div>
              <div class="metric"><span>First date</span><strong>${group.firstDate ? escapeHtml(formatDate(group.firstDate)) : "Unknown"}</strong></div>
              <div class="metric"><span>Last date</span><strong>${group.lastDate ? escapeHtml(formatDate(group.lastDate)) : "Unknown"}</strong></div>
              <div class="metric"><span>Income</span><strong>${formatSek(group.incomeSek)}</strong></div>
            </div>
            ${csvImportRowsTableTemplate(group.rows)}
          </div>
        </details>
      `).join("")}
    </div>
  `;
}

function csvImportRowsTableTemplate(rows) {
  const sorted = [...rows].sort(compareTransactionsForDisplay);
  return `
    <div class="table-wrap ai-import-table-wrap csv-import-history-table">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Asset</th>
            <th>Quantity</th>
            <th>SEK / unit</th>
            <th>Value</th>
            <th>Income</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => `
            <tr>
              <td>${formatDate(row.date || row.traded_at)}</td>
              <td>${escapeHtml(formatTransactionType(row.type || "trade"))}</td>
              <td>${escapeHtml(transactionAssetDisplay(row))}</td>
              <td>${escapeHtml(transactionQuantityDisplay(row))}</td>
              <td>${formatTransactionSekValue(transactionValuationPriceSek(row))}</td>
              <td>${formatTransactionSekValue(transactionEstimatedValueSek(row))}</td>
              <td>${formatSek(transactionIncomeSek(row))}</td>
              <td>${escapeHtml(row.notes || row.raw?.notes || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatCsvSekValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(number) < 1 ? 4 : 2,
  });
}

function formatReportSek(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return formatSek(0);
  if (number !== 0 && Math.abs(number) < 1) return formatCsvSekValue(number);
  return formatSek(number);
}

function apiImportPreviewTemplate(preview) {
  if (!preview) {
    return `<div class="empty-state"><h3>No API count yet</h3><p class="muted">Import starts by counting Binance API rows for ${escapeHtml(state.selectedTaxYear)}. After that you can continue directly to payment or import.</p></div>`;
  }
  const plan = preview.recommendedPlan || selectedPlan();
  return `
    <div class="summary-strip discovery-strip">
      <div class="metric"><span>Selected-year rows</span><strong>${formatCount(preview.rowCount)}</strong></div>
      <div class="metric"><span>Workspace rows</span><strong>${formatCount(preview.workspaceRowCount || preview.rowCount)}</strong></div>
      <div class="metric"><span>Package</span><strong>${escapeHtml(plan.name)}</strong></div>
      <div class="metric"><span>Price</span><strong>${formatMinorSek(plan.priceAmount || 0)}</strong></div>
    </div>
    ${preview.capped ? `<div class="alert"><strong>Preview capped</strong><p class="small muted">The API returned at least ${formatCount(preview.rowCount)} rows. Use the high-volume tier or support review before importing.</p></div>` : ""}
    ${preview.productSummaries?.length ? `
      <div class="statement-list">
        ${preview.productSummaries.map((item) => `
          <div class="statement-row">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <span class="muted">${escapeHtml(item.message || "")}</span>
            </div>
            <div class="statement-meta">
              <span class="badge ${item.status === "imported" ? "" : item.status === "empty" ? "badge-blue" : "badge-yellow"}">${escapeHtml(item.status)}</span>
              <span>${formatCount(item.count || 0)} rows</span>
            </div>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function importPathTemplate(discovery, statementDate) {
  const coverageCount = discovery?.productAreasChecked || discovery?.productCoverage?.length || 0;
  return `
    <section class="section import-path">
      <div>
        <h2>How to import this year</h2>
        <p class="muted">Use the ${escapeHtml(statementDate)} Binance account statement as the starting snapshot, then review product coverage for missing areas like Earn, Futures, Convert, deposits, withdrawals, and rewards.</p>
      </div>
      <div class="import-path-steps">
        <div><span>1</span><strong>Run discovery</strong><small>${coverageCount ? `${formatCount(coverageCount)} product areas checked` : "Check account products"}</small></div>
        <div><span>2</span><strong>Upload statement PDF</strong><small>AI extracts holdings for review</small></div>
        <div><span>3</span><strong>Save reviewed snapshot</strong><small>Cost basis remains separate</small></div>
      </div>
    </section>
  `;
}

function statementPreviewTemplate() {
  const openingBalances = selectedYearOpeningBalances();
  if (!openingBalances.length) return "";
  const totalValueUsd = openingBalances.reduce((sum, row) => sum + Number(row.valueUsd || 0), 0);
  const draft = selectedYearStatementDraft() || {};
  const statementDate = String(draft.statementDate || yearStartStatementDate()).slice(0, 10);
  const hasDraft = Boolean(selectedYearStatementDraft());
  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  return `
    <div class="statement-preview">
      ${draft.sourceType === "ai_pdf_statement" ? `<div class="alert"><strong>AI extracted statement rows</strong><p class="small muted">Review asset symbols, quantities, and USD values before saving.</p></div>` : ""}
      ${!hasDraft ? `<div class="alert alert-success"><strong>Statement rows loaded</strong><p class="small muted">These rows are available as the year-start snapshot for this session.</p></div>` : ""}
      ${warnings.length ? `<div class="alert"><strong>Extraction warnings</strong><p class="small muted">${warnings.map(escapeHtml).join(" ")}</p></div>` : ""}
      <div class="summary-strip discovery-strip">
        <div class="metric">
          <span>statement assets</span>
          <strong>${formatCount(openingBalances.length)}</strong>
        </div>
        <div class="metric">
          <span>statement value</span>
          <strong>${totalValueUsd ? `${formatAssetQuantity(totalValueUsd)} USD` : "Not supplied"}</strong>
        </div>
        <div class="metric">
          <span>statement date</span>
          <strong>${escapeHtml(statementDate)}</strong>
        </div>
      </div>
      <div class="statement-list">
        ${openingBalances
          .map(
            (row) => `
              <div class="statement-row">
                <div class="statement-main">
                  <strong>${escapeHtml(row.asset)}</strong>
                  <span class="muted">${formatAssetQuantity(row.quantity)} units</span>
                </div>
                <div class="statement-meta">
                  <span>${row.valueUsd ? `${formatAssetQuantity(row.valueUsd)} USD` : "No value"}</span>
                  <span>${escapeHtml(row.costBasisStatus || "unknown")}</span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
      ${
        hasDraft
          ? `<div class="button-row import-actions"><button class="btn btn-primary" type="button" data-action="save-statement-draft">Save reviewed statement</button></div>`
          : ""
      }
    </div>
  `;
}

function binanceConnectionControls(hasConnection, connectionLabelValue) {
  if (hasConnection && !state.editingConnection) {
    const discovery = selectedYearDiscovery();
    const transactions = selectedYearTransactions();
    const discoveryDone = Boolean(discovery);
    const importDone = transactions.length > 0;
    const accountLine = discovery?.account?.uid
      ? `Binance UID ${escapeHtml(discovery.account.uid)}`
      : state.connection.apiKeyHint
        ? escapeHtml(tr("keyHint", { key: state.connection.apiKeyHint }))
        : t("readyForDiscovery");
    return `
      <div class="connection-summary">
        <strong>${escapeHtml(state.connection.label || t("mainBinance"))}</strong>
        <span>${accountLine}</span>
      </div>
      <div class="button-row">
        <button class="btn ${discoveryDone ? "btn-secondary" : "btn-primary"}" type="button" data-action="start-discovery">${discoveryDone ? t("rerunDiscovery") : t("runDiscovery")}</button>
        <button class="btn ${discoveryDone && !importDone ? "btn-primary" : "btn-secondary"}" type="button" data-action="${importDone ? "refresh-api-transactions" : "start-api-import"}" ${discovery ? "" : "disabled"}>${importDone ? t("refreshTransactions") : t("importRefreshTransactions")}</button>
      </div>
      <details class="compact-settings">
        <summary>${t("connectionSettings")}</summary>
        <button class="btn btn-secondary" type="button" data-action="replace-binance-key">${t("replaceKey")}</button>
      </details>
    `;
  }
  return `
    <form class="form-grid" data-form="binance">
      <div class="form-row">
        <label for="api-key">${t("binanceTaxApiKey")}</label>
        <input id="api-key" name="apiKey" autocomplete="off" placeholder="${t("binanceTaxApiKey")}" />
      </div>
      <div class="form-row">
        <label for="api-secret">${t("binanceTaxApiSecret")}</label>
        <input id="api-secret" name="apiSecret" autocomplete="off" type="password" placeholder="${t("binanceTaxApiSecret")}" />
      </div>
      <div class="input-inline">
        <div class="form-row">
          <label for="connection-label">${t("label")}</label>
          <input id="connection-label" name="label" value="${escapeHtml(connectionLabelValue)}" />
        </div>
        <button class="btn btn-primary" type="submit">${hasConnection ? t("saveKey") : t("connect")}</button>
      </div>
    </form>
    <p class="small muted">${t("generateBinanceKeyHelp")}</p>
    <div class="button-row">
      <button class="btn btn-secondary" type="button" data-action="start-discovery" ${hasConnection ? "" : "disabled"}>${t("runDiscovery")}</button>
      ${hasConnection ? `<button class="btn btn-quiet" type="button" data-action="cancel-replace-binance-key">${t("cancel")}</button>` : ""}
    </div>
  `;
}

function discoveryTemplate(discovery) {
  if (!discovery) {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("discovery")}</h2>
            <p class="muted">${t("discoveryHelp")}</p>
          </div>
          <span class="badge badge-blue">${t("runFirst")}</span>
        </div>
        <div class="empty-state">
          <h3>${t("noDiscoveryYet")}</h3>
          <p class="muted">${escapeHtml(tr("connectRunDiscoveryForYear", { year: state.selectedTaxYear }))}</p>
        </div>
      </div>
    `;
  }
  const assets = Array.isArray(discovery.nonZeroAssets) ? discovery.nonZeroAssets : [];
  const assetCount = discovery.nonZeroAssetCount || assets.length;
  const visibleAssets = assets.slice(0, 18).map((asset) => escapeHtml(asset)).join(", ");
  const hiddenAssets = Math.max(0, assetCount - 18);
  const sourceLabel = discovery.sourceLabel || "Binance account snapshot";
  return `
    <div class="card">
      <div class="card-header">
          <div>
          <h2>${t("discovery")}</h2>
          <p class="muted">${escapeHtml(tr("discoverySourceForYear", { source: sourceLabel, year: discovery.taxYear }))}</p>
        </div>
        <span class="badge">${t("ready")}</span>
      </div>
      <p class="small muted discovery-assets">${visibleAssets || t("noSpotAssets")}${hiddenAssets ? `, +${formatCount(hiddenAssets)} ${t("more")}` : ""}</p>
      ${productCoverageTemplate(discovery.productCoverage)}
      ${discovery.message ? `<p class="small muted">${escapeHtml(discovery.message)}</p>` : ""}
    </div>
  `;
}

function productCoverageTemplate(items = []) {
  if (!items.length) return "";
  return `
    <div class="subsection">
      <h3>${t("productCoverage")}</h3>
      <div class="coverage-grid">
        ${items
          .map(
            (item) => `
              <div class="coverage-item">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <span class="muted">${escapeHtml(item.message || "")}</span>
                </div>
                <div class="statement-meta">
                  <span class="badge ${coverageBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
                  <span>${item.count ? `${formatCount(item.count)} ${t("items")}` : escapeHtml(item.sampled ? t("sample") : item.group || "")}</span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
      <p class="small muted">${t("coverageCheckHelp")}</p>
    </div>
  `;
}

function coverageBadgeClass(status) {
  if (status === "found" || status === "imported") return "";
  if (status === "empty") return "badge-blue";
  return "badge-yellow";
}

function transactionFiltersTemplate(transactions) {
  const categoryOptions = [
    { key: "all", label: t("all") },
    { key: "income", label: t("income") },
    { key: "interest", label: t("interest") },
    { key: "convert", label: t("convert") },
    { key: "transfers", label: t("transfers") },
    { key: "trades", label: t("trades") },
    { key: "fees", label: t("fees") },
  ];
  const typeOptions = availableTransactionTypes(transactions);
  const assetOptions = availableTransactionAssets(transactions);
  return `
    <div class="transaction-filters">
      <div class="button-row transaction-filter-pills">
        ${categoryOptions
          .map(
            (option) => `
              <button
                class="btn ${state.transactionCategoryFilter === option.key ? "btn-primary" : "btn-secondary"} btn-filter"
                type="button"
                data-action="set-transaction-category:${option.key}"
              >${escapeHtml(option.label)}</button>
            `,
          )
          .join("")}
      </div>
      <div class="transaction-filter-bar">
        <div class="form-row">
          <label for="transaction-type-filter">${t("type")}</label>
          <select id="transaction-type-filter" data-field="transaction-type-filter">
            <option value="all">${t("allTypes")}</option>
            ${typeOptions.map((type) => `<option value="${escapeHtml(type)}" ${state.transactionTypeFilter === type ? "selected" : ""}>${escapeHtml(formatTransactionType(type))}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <label for="transaction-asset-filter">${t("coin")}</label>
          <select id="transaction-asset-filter" data-field="transaction-asset-filter">
            <option value="all">${t("allCoins")}</option>
            ${assetOptions.map((asset) => `<option value="${escapeHtml(asset)}" ${state.transactionAssetFilter === asset ? "selected" : ""}>${escapeHtml(asset)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
  `;
}

function transactionTableTemplate(compact = false, sourceTransactions = null) {
  const transactions = Array.isArray(sourceTransactions) ? sourceTransactions : selectedYearTransactions();
  if (!transactions.length) {
    const hasAnyTransactions = selectedYearTransactions().length > 0;
    return hasAnyTransactions
      ? `<div class="empty-state"><h3>${t("noMatchingTransactions")}</h3><p class="muted">${t("changeFilters")}</p></div>`
      : `<div class="empty-state"><h3>${t("noImportedTransactions")}</h3><p class="muted">${t("runDiscoveryImport")}</p></div>`;
  }
  const sortedTransactions = [...transactions].sort(compareTransactionsForDisplay);
  const displayTransactions = buildTransactionDisplayRows(sortedTransactions);
  const visibleLimit = compact ? 8 : Math.max(1, Number(state.transactionVisibleCount || 100));
  const visibleRows = displayTransactions.slice(0, visibleLimit);
  const canSelectRows = !compact && state.transactionAssetFilter !== "all";
  const selected = new Set(state.selectedTransactionIds || []);
  const selectedVisibleCount = visibleRows.filter((item) => selected.has(transactionDisplayRowId(item))).length;
  return `
    ${canSelectRows ? transactionBulkBarTemplate(visibleRows, selectedVisibleCount, displayTransactions.length) : ""}
    <div class="table-wrap transaction-table-wrap">
      <table>
        <thead>
          <tr>
            ${canSelectRows ? `<th class="select-col"><input type="checkbox" data-field="transaction-select-visible" ${visibleRows.length && selectedVisibleCount === visibleRows.length ? "checked" : ""} aria-label="${t("selectVisibleRows")}" /></th>` : ""}
            <th>${t("date")}</th>
            <th>${t("sourceName")}</th>
            <th>${t("type")}</th>
            <th>${t("asset")}</th>
            <th>${t("quantity")}</th>
            <th>${t("sekPerUnit")}</th>
            <th>${t("estValue")}</th>
            <th>${t("proceeds")}</th>
            <th>${t("costBasis")}</th>
            <th>${t("basisStatus")}</th>
            <th>${t("confidence")}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows
            .map(
              (item) => `
              <tr>
                ${canSelectRows ? `<td class="select-col" data-label="${t("selected")}"><input type="checkbox" data-field="transaction-select-row" value="${escapeHtml(transactionDisplayRowId(item))}" ${selected.has(transactionDisplayRowId(item)) ? "checked" : ""} aria-label="${t("selectTransaction")}" /></td>` : ""}
                <td data-label="${t("date")}">${formatDate(item.date || item.traded_at)}</td>
                <td data-label="${t("sourceName")}">${escapeHtml(transactionSourceDisplay(item))}</td>
                <td data-label="${t("type")}">${escapeHtml(formatTransactionType(item.type || "trade"))}</td>
                <td data-label="${t("asset")}">${escapeHtml(transactionAssetDisplay(item))}</td>
                <td data-label="${t("quantity")}">${escapeHtml(transactionQuantityDisplay(item))}</td>
                <td data-label="${t("sekPerUnit")}">${item.isConversionGroup ? "" : formatTransactionSekValue(transactionValuationPriceSek(item))}</td>
                <td data-label="${t("estValue")}">${formatTransactionSekValue(transactionEstimatedValueSek(item))}</td>
                <td data-label="${t("proceeds")}">${formatSek(transactionProceedsSek(item))}</td>
                <td data-label="${t("costBasis")}">${formatSek(transactionCostBasisSek(item))}</td>
                <td data-label="${t("basisStatus")}">${escapeHtml(transactionCostBasisStatus(item))}</td>
                <td data-label="${t("confidence")}">${formatConfidence(item.confidence || 0.84)}</td>
                <td class="actions-col" data-label="${t("actions")}">${transactionActionsTemplate(item)}</td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${!compact && displayTransactions.length > visibleRows.length ? `
      <div class="table-footer-actions">
        <button class="btn btn-secondary" type="button" data-action="load-more-transactions">${t("loadMore")}</button>
        <span class="small muted">${formatCount(visibleRows.length)} / ${formatCount(displayTransactions.length)} ${t("shown")}</span>
      </div>
    ` : !compact ? `<p class="small muted table-count-note">${formatCount(visibleRows.length)} / ${formatCount(displayTransactions.length)} ${t("shown")}</p>` : ""}
  `;
}

function transactionBulkBarTemplate(visibleRows, selectedVisibleCount, totalRows) {
  const selectedCount = (state.selectedTransactionIds || []).length;
  return `
    <div class="transaction-bulk-bar">
      <div>
        <strong>${selectedCount ? escapeHtml(tr("selectedRows", { count: formatCount(selectedCount) })) : escapeHtml(tr("selectAsset", { asset: state.transactionAssetFilter }))}</strong>
        <span class="small muted">${t("bulkAfterCoin")}</span>
      </div>
      <div class="button-row">
        <button class="btn btn-secondary" type="button" data-action="select-visible-transactions" ${visibleRows.length && selectedVisibleCount !== visibleRows.length ? "" : "disabled"}>${t("selectVisible")}</button>
        <button class="btn btn-secondary" type="button" data-action="clear-selected-transactions" ${selectedCount ? "" : "disabled"}>${t("clear")}</button>
        <button class="btn btn-secondary btn-danger" type="button" data-action="exclude-selected-transactions" ${selectedCount ? "" : "disabled"}>${t("excludeSelected")}</button>
      </div>
      <span class="small muted">${escapeHtml(tr("filteredRows", { count: formatCount(totalRows) }))}</span>
    </div>
  `;
}

function transactionActionsTemplate(item) {
  return `
    <details class="row-actions">
      <summary aria-label="${t("transactionActions")}">...</summary>
      <div>
        <button type="button" data-action="edit-transaction:${escapeHtml(transactionDisplayRowId(item))}">${t("edit")}</button>
        <button type="button" data-action="exclude-transaction:${escapeHtml(transactionDisplayRowId(item))}">${t("remove")}</button>
      </div>
    </details>
  `;
}

function buildTransactionDisplayRows(transactions) {
  const groups = new Map();
  const groupedIds = new Set();
  for (const item of transactions) {
    const type = String(item?.type || "").toLowerCase();
    if (type !== "convert_in" && type !== "convert_out") continue;
    const key = convertDisplayGroupKey(item);
    const group = groups.get(key) || {};
    if (type === "convert_in") group.in = item;
    if (type === "convert_out") group.out = item;
    groups.set(key, group);
  }

  const groupRows = [];
  for (const [key, group] of groups.entries()) {
    if (!group.in || !group.out) continue;
    groupedIds.add(group.in.externalId || group.in.external_id);
    groupedIds.add(group.out.externalId || group.out.external_id);
    const conversionValue = Math.max(
      transactionEstimatedValueSek(group.in),
      transactionEstimatedValueSek(group.out),
      Number(group.in.costSek || group.in.cost_basis_sek || 0),
      Number(group.out.proceedsSek || group.out.proceeds_sek || 0),
    );
    groupRows.push({
      isConversionGroup: true,
      externalId: `convert-group:${key}`,
      excludedIds: [transactionRowId(group.in), transactionRowId(group.out)],
      date: group.in.date || group.in.traded_at || group.out.date || group.out.traded_at,
      traded_at: group.in.traded_at || group.out.traded_at,
      type: "convert",
      fromAsset: group.out.asset || group.out.asset_symbol || "",
      toAsset: group.in.asset || group.in.asset_symbol || "",
      fromQuantity: group.out.quantity || 0,
      toQuantity: group.in.quantity || 0,
      quantity: group.in.quantity || 0,
      proceedsSek: group.out.proceedsSek || group.out.proceeds_sek || conversionValue,
      costSek: group.in.costSek || group.in.cost_basis_sek || conversionValue,
      confidence: Math.min(Number(group.in.confidence || 0.84), Number(group.out.confidence || 0.84)),
      raw: {
        source: transactionSourceRaw(group.in) || transactionSourceRaw(group.out),
        valuation: {
          estimatedValueSek: conversionValue,
          priceSek: 0,
        },
      },
    });
  }

  const singles = transactions.filter((item) => !groupedIds.has(item.externalId || item.external_id));
  return [...singles, ...groupRows].sort(compareTransactionsForDisplay);
}

function taxCalculationRows(transactions) {
  return buildTransactionDisplayRows(Array.isArray(transactions) ? transactions : []);
}

function transactionSourceRaw(item) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === "object" ? raw.raw : raw;
  return raw.sourceName || raw.source_name || raw.source || nestedRaw.sourceName || nestedRaw.source_name || nestedRaw.source || "";
}

function transactionRowId(item) {
  return String(item?.externalId || item?.external_id || "");
}

function transactionDisplayRowId(item) {
  return String(item?.externalId || item?.external_id || "");
}

function transactionExcludedIdsForDisplayRow(displayRow) {
  if (Array.isArray(displayRow?.excludedIds)) return displayRow.excludedIds.filter(Boolean);
  const id = transactionDisplayRowId(displayRow);
  return id ? [id] : [];
}

function transactionSourceDisplay(item) {
  const source = String(transactionSourceRaw(item) || item?.source || "").toLowerCase();
  if (source.includes("abra")) return "Abra";
  if (source.includes("binance")) return "Binance";
  if (source.includes("coinbase")) return "Coinbase";
  if (source.includes("kraken")) return "Kraken";
  if (source.includes("ai_csv")) return "CSV";
  if (!source) return "Unknown";
  return source
    .replace(/_ai_csv|_csv|_api/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function convertDisplayGroupKey(item) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === "object" ? raw.raw : raw;
  const orderId = nestedRaw.orderId || nestedRaw.quoteId;
  if (orderId) return String(orderId);
  return String(item?.externalId || item?.external_id || "").replace(/:(in|out)$/i, "");
}

function transactionAssetDisplay(item) {
  if (item?.isConversionGroup) return `${item.fromAsset} -> ${item.toAsset}`;
  return item.asset || item.asset_symbol || "";
}

function transactionQuantityDisplay(item) {
  if (item?.isConversionGroup) return `${formatQuantity(item.fromQuantity)} -> ${formatQuantity(item.toQuantity)}`;
  return formatQuantity(item.quantity || 0);
}

function transactionCostBasisStatus(item) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const costBasis = raw.costBasis && typeof raw.costBasis === "object" ? raw.costBasis : {};
  const status = String(costBasis.status || "").replace(/_/g, " ");
  if (status === "stablecoin usd peg fallback") return "stablecoin USD peg";
  if (status) return status;
  if (Number(item?.costSek || item?.cost_basis_sek || 0) > 0) return "calculated";
  if (["income", "reward", "interest", "staking"].includes(String(item?.type || "").toLowerCase())) return "income basis";
  return "not needed yet";
}

function filteredTransactionsForView(transactions) {
  return (Array.isArray(transactions) ? transactions : []).filter((item) => {
    const type = String(item?.type || "trade").toLowerCase();
    const asset = String(item?.asset || item?.asset_symbol || "").toUpperCase();

    if (state.transactionCategoryFilter === "income" && !["income", "reward", "staking"].includes(type)) return false;
    if (state.transactionCategoryFilter === "interest" && type !== "interest") return false;
    if (state.transactionCategoryFilter === "convert" && !type.startsWith("convert")) return false;
    if (state.transactionCategoryFilter === "transfers" && !["deposit", "withdrawal"].includes(type)) return false;
    if (state.transactionCategoryFilter === "trades" && !["buy", "sell", "trade"].includes(type)) return false;
    if (state.transactionCategoryFilter === "fees" && type !== "fee") return false;

    if (state.transactionTypeFilter !== "all" && type !== state.transactionTypeFilter) return false;
    if (state.transactionAssetFilter !== "all" && asset !== state.transactionAssetFilter) return false;
    return true;
  });
}

function currentTransactionDisplayRows() {
  return buildTransactionDisplayRows([...filteredTransactionsForView(selectedYearTransactions())].sort(compareTransactionsForDisplay));
}

function visibleTransactionDisplayRows() {
  return currentTransactionDisplayRows().slice(0, Math.max(1, Number(state.transactionVisibleCount || 100)));
}

function loadMoreTransactions() {
  setState({ transactionVisibleCount: Math.min(currentTransactionDisplayRows().length, Number(state.transactionVisibleCount || 100) + 100), error: "", notice: "" });
}

function loadMoreReportIncome() {
  const incomeRows = selectedYearTransactions().filter((row) => transactionIncomeSek(row) > 0);
  setState({ reportIncomeVisibleCount: Math.min(incomeRows.length, Number(state.reportIncomeVisibleCount || 100) + 100), error: "", notice: "" });
}

function toggleSelectedTransaction(id, checked) {
  const selected = new Set(state.selectedTransactionIds || []);
  if (checked) selected.add(String(id));
  else selected.delete(String(id));
  setState({ selectedTransactionIds: [...selected], error: "", notice: "" });
}

function toggleVisibleTransactions(checked) {
  const selected = new Set(state.selectedTransactionIds || []);
  visibleTransactionDisplayRows().forEach((row) => {
    const id = transactionDisplayRowId(row);
    if (!id) return;
    if (checked) selected.add(id);
    else selected.delete(id);
  });
  setState({ selectedTransactionIds: [...selected], error: "", notice: "" });
}

function excludeTransactionDisplayRow(displayRowId) {
  const row = currentTransactionDisplayRows().find((item) => transactionDisplayRowId(item) === displayRowId);
  if (!row) return;
  excludeTransactionDisplayRows([row]);
}

function excludeSelectedTransactions() {
  const selected = new Set(state.selectedTransactionIds || []);
  const rows = currentTransactionDisplayRows().filter((item) => selected.has(transactionDisplayRowId(item)));
  if (!rows.length) {
    setState({ error: "Select rows before excluding them." });
    return;
  }
  excludeTransactionDisplayRows(rows);
}

function excludeTransactionDisplayRows(rows) {
  const excluded = new Set(state.excludedTransactionIds || []);
  rows.forEach((row) => transactionExcludedIdsForDisplayRow(row).forEach((id) => excluded.add(id)));
  setState({
    excludedTransactionIds: [...excluded],
    selectedTransactionIds: [],
    transactionVisibleCount: 100,
    report: null,
    notice: `${formatCount(rows.length)} row${rows.length === 1 ? "" : "s"} excluded from the current report. Reimport or refresh to restore them.`,
    error: "",
  });
}

function editTransactionDisplayRow(displayRowId) {
  const row = currentTransactionDisplayRows().find((item) => transactionDisplayRowId(item) === displayRowId);
  if (!row) return;
  if (row.isConversionGroup) {
    setState({ error: "Grouped convert rows cannot be edited as one row yet. Remove/reimport or edit the source CSV before import." });
    return;
  }
  const id = transactionRowId(row);
  const current = state.transactions.find((item) => transactionRowId(item) === id);
  if (!current) return;
  const nextType = window.prompt("Type", String(current.type || "income"));
  if (nextType === null) return;
  const nextAsset = window.prompt("Asset", String(current.asset || current.asset_symbol || ""));
  if (nextAsset === null) return;
  const nextQuantity = window.prompt("Quantity", String(current.quantity || 0));
  if (nextQuantity === null) return;
  const nextIncome = window.prompt("Income SEK", String(current.incomeSek || current.income_sek || 0));
  if (nextIncome === null) return;
  const nextProceeds = window.prompt("Proceeds SEK", String(current.proceedsSek || current.proceeds_sek || 0));
  if (nextProceeds === null) return;
  const nextCost = window.prompt("Cost basis SEK", String(current.costSek || current.cost_basis_sek || 0));
  if (nextCost === null) return;
  const nextNotes = window.prompt("Notes", String(current.notes || ""));
  if (nextNotes === null) return;
  const updated = state.transactions.map((item) => {
    if (transactionRowId(item) !== id) return item;
    const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
    return {
      ...item,
      type: String(nextType || item.type || "trade").toLowerCase(),
      asset: String(nextAsset || item.asset || item.asset_symbol || "").toUpperCase(),
      asset_symbol: String(nextAsset || item.asset_symbol || item.asset || "").toUpperCase(),
      quantity: parseNumberValue(nextQuantity),
      incomeSek: parseNumberValue(nextIncome),
      income_sek: parseNumberValue(nextIncome),
      proceedsSek: parseNumberValue(nextProceeds),
      proceeds_sek: parseNumberValue(nextProceeds),
      costSek: parseNumberValue(nextCost),
      cost_basis_sek: parseNumberValue(nextCost),
      notes: nextNotes,
      raw: { ...raw, manualOverride: { updatedAt: new Date().toISOString(), reason: "user_edit" } },
    };
  });
  setState({ transactions: updated, report: null, notice: "Transaction row edited for the current workspace session. Regenerate the report after reviewing changes.", error: "" });
}

function availableTransactionTypes(transactions) {
  return [...new Set((Array.isArray(transactions) ? transactions : []).map((item) => String(item?.type || "trade").toLowerCase()).filter(Boolean))].sort();
}

function availableTransactionAssets(transactions) {
  return [...new Set((Array.isArray(transactions) ? transactions : []).map((item) => String(item?.asset || item?.asset_symbol || "").toUpperCase()).filter(Boolean))].sort();
}

function compareTransactionsForDisplay(left, right) {
  const typeOrder = ["income", "reward", "interest", "staking", "deposit", "withdrawal", "convert_in", "convert_out", "buy", "sell", "trade", "fee"];
  const leftType = String(left?.type || "trade").toLowerCase();
  const rightType = String(right?.type || "trade").toLowerCase();
  const leftTypeRank = typeOrder.indexOf(leftType);
  const rightTypeRank = typeOrder.indexOf(rightType);
  const normalizedLeftRank = leftTypeRank === -1 ? typeOrder.length : leftTypeRank;
  const normalizedRightRank = rightTypeRank === -1 ? typeOrder.length : rightTypeRank;
  if (normalizedLeftRank !== normalizedRightRank) return normalizedLeftRank - normalizedRightRank;

  const assetCompare = String(left?.asset || left?.asset_symbol || "").localeCompare(String(right?.asset || right?.asset_symbol || ""));
  if (assetCompare !== 0) return assetCompare;

  return String(right?.date || right?.traded_at || "").localeCompare(String(left?.date || left?.traded_at || ""));
}

function formatTransactionType(type) {
  const value = String(type || "trade").trim().toLowerCase();
  const labels = currentLanguage() === "sv"
    ? {
        income: "Inkomst",
        reward: "Reward",
        interest: "Ränta",
        staking: "Staking",
        deposit: "Insättning",
        withdrawal: "Uttag",
        convert_in: "Växling in",
        convert_out: "Växling ut",
        buy: "Köp",
        sell: "Sälj",
        trade: "Trade",
        fee: "Avgift",
      }
    : {
        income: "Income",
        reward: "Reward",
        interest: "Interest",
        staking: "Staking",
        deposit: "Deposit",
        withdrawal: "Withdrawal",
        convert_in: "Convert in",
        convert_out: "Convert out",
        buy: "Buy",
        sell: "Sell",
        trade: "Trade",
        fee: "Fee",
      };
  return labels[value] || value.replace(/_/g, " ");
}

function translatedReportSections() {
  if (currentLanguage() === "sv") {
    return [t("k4Grouped"), t("incomeSummary"), t("sekTrail"), t("costBasisMemo")];
  }
  return reportSections;
}

function transactionValuationPriceSek(item) {
  return Number(item?.raw?.valuation?.priceSek || item?.raw?.valuation?.price_sek || 0) || 0;
}

function transactionEstimatedValueSek(item) {
  return Number(item?.raw?.valuation?.estimatedValueSek || item?.raw?.valuation?.estimated_value_sek || 0) || 0;
}

function transactionIncomeSek(item) {
  const direct = Number(item?.incomeSek || item?.income_sek || 0) || 0;
  if (direct > 0) return direct;
  const type = String(item?.type || "").toLowerCase();
  if (["income", "reward", "interest", "staking"].includes(type)) return transactionEstimatedValueSek(item);
  return 0;
}

function transactionProceedsSek(item) {
  const direct = Number(item?.proceedsSek || item?.proceeds_sek || 0) || 0;
  if (direct > 0) return direct;
  const type = String(item?.type || "").toLowerCase();
  if (["sell", "convert_out", "trade", "outflow"].includes(type)) return transactionEstimatedValueSek(item);
  return 0;
}

function transactionCostBasisSek(item) {
  return Number(item?.costSek || item?.cost_basis_sek || 0) || 0;
}

function formatTransactionSekValue(value) {
  const number = Number(value || 0);
  if (number <= 0) return "Manual price needed";
  return number.toLocaleString("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: Math.abs(number) < 1 ? 2 : 0,
    maximumFractionDigits: Math.abs(number) < 1 ? 4 : 0,
  });
}

function transactionHasValuation(item) {
  return transactionValuationPriceSek(item) > 0 && transactionEstimatedValueSek(item) > 0;
}

function reportsTemplate() {
  const transactions = selectedYearTransactions();
  const report = selectedYearReport();
  const summary = summarizeTransactions(transactions);
  const calculationRows = taxCalculationRows(transactions);
  const disposalRows = calculationRows.filter((row) => transactionProceedsSek(row) > 0 || ["sell", "convert", "convert_out", "trade", "outflow"].includes(String(row.type || "").toLowerCase()));
  const k4Rows = k4RowsFromDisposals(disposalRows);
  const k4Totals = summarizeK4Rows(k4Rows);
  const explanation = tr("reportSummary", {
    year: state.selectedTaxYear,
    rows: formatCount(summary.count),
    k4Rows: formatCount(k4Rows.length),
    plural: k4Rows.length === 1 ? "" : currentLanguage() === "sv" ? "er" : "s",
    profit: formatSek(k4Totals.profit),
    loss: formatSek(k4Totals.loss),
    income: formatSek(summary.income),
  });
  return `
    <section class="section grid grid-2">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("k4Report")}</h2>
            <p class="muted">${t("k4ReportHelp")}</p>
          </div>
          <span class="badge">${report ? t("generated") : t("draft")}</span>
        </div>
        <div class="grid grid-2">
          <div class="metric"><span>${t("k4SectionRows")}</span><strong>${formatCount(k4Rows.length)}</strong></div>
          <div class="metric"><span>${t("k4Profit")}</span><strong>${formatSek(k4Totals.profit)}</strong></div>
          <div class="metric"><span>${t("k4Loss")}</span><strong>${formatSek(k4Totals.loss)}</strong></div>
          <div class="metric"><span>${t("otherIncome")}</span><strong>${formatSek(summary.income)}</strong></div>
        </div>
        <div class="section button-row">
          <button class="btn btn-primary" type="button" data-action="generate-report">${t("generateReport")}</button>
          <button class="btn btn-secondary" type="button" data-action="print-report">${t("saveK4Pdf")}</button>
          <button class="btn btn-secondary" type="button" data-action="download-k4-csv">${t("downloadK4Csv")}</button>
        </div>
      </div>
      <details class="card accordion-card report-audit-accordion">
        <summary>
          <span>
            <strong>${t("auditExplanation")}</strong>
            <small>${t("auditExplanationHelp")}</small>
          </span>
          <span class="accordion-chevron">+</span>
        </summary>
        <div class="report-audit-body">
          <p id="report-explanation">${escapeHtml(explanation)}</p>
          <div class="alert">
            <strong>${t("digitalFilingNote")}</strong>
            <p class="small muted">${t("digitalFilingHelp")}</p>
          </div>
          ${skatteverketGuideTemplate()}
          ${otherIncomeGuideTemplate()}
          <div class="workflow-list">
            ${translatedReportSections()
              .map(
                (section, index) => `
                <div class="workflow-item">
                  <div class="workflow-index">${index + 1}</div>
                  <div><p class="muted small">${escapeHtml(section)}</p></div>
                </div>
              `,
              )
              .join("")}
          </div>
        </div>
      </details>
    </section>
    ${printableReportTemplate(transactions, summary, explanation)}
  `;
}

function skatteverketGuideTemplate() {
  return `
    <div class="alert report-guide">
      <strong>${t("skatteverketGuideTitle")}</strong>
      <p class="small muted">${t("skatteverketGuideHelp")}</p>
      <ol class="small muted report-guide-list">
        <li>${t("skatteverketGuideStep1")}</li>
        <li>${t("skatteverketGuideStep2")}</li>
        <li>${t("skatteverketGuideStep3")}</li>
        <li>${t("skatteverketGuideStep4")}</li>
      </ol>
      <a class="inline-link" href="https://www.skatteverket.se/privat/skatter/vardepapper/andratillgangar/kryptovalutor.4.15532c7b1442f256bae11b60.html" target="_blank" rel="noopener noreferrer">${t("skatteverketGuideLink")}</a>
    </div>
  `;
}

function otherIncomeGuideTemplate() {
  return `
    <div class="alert report-guide">
      <strong>${t("otherIncomeDeclarationTitle")}</strong>
      <p class="small muted">${t("otherIncomeDeclarationHelp")}</p>
      <ol class="small muted report-guide-list">
        <li>${t("otherIncomeGuideStep1")}</li>
        <li>${t("otherIncomeGuideStep2")}</li>
        <li>${t("otherIncomeGuideStep3")}</li>
        <li>${t("otherIncomeGuideStep4")}</li>
      </ol>
      <p class="small muted">${t("otherIncomeGuideExceptions")}</p>
      <a class="inline-link" href="https://www.skatteverket.se/privat/deklaration/innehalletideklarationen.4.3810a01c150939e893f244dd.html" target="_blank" rel="noopener noreferrer">${t("skatteverketDeclarationGuideLink")}</a>
    </div>
  `;
}

function printableReportTemplate(transactions, summary, explanation) {
  const calculationRows = taxCalculationRows(transactions);
  const incomeRows = transactions.filter((row) => transactionIncomeSek(row) > 0);
  const disposalRows = calculationRows.filter((row) => transactionProceedsSek(row) > 0 || ["sell", "convert", "convert_out", "trade", "outflow"].includes(String(row.type || "").toLowerCase()));
  const k4Rows = k4RowsFromDisposals(disposalRows);
  const k4Totals = summarizeK4Rows(k4Rows);
  const missingBasisRows = calculationRows.filter((row) => String(row?.raw?.costBasis?.status || "").includes("unknown_zero_fallback"));
  const missingPriceRows = transactions.filter((row) => !transactionHasValuation(row));
  const missingPriceAssets = [...new Set(missingPriceRows.map((row) => String(row.asset || row.asset_symbol || "").toUpperCase()).filter(Boolean))].sort();
  const incomeBySource = summarizeIncomeBySource(incomeRows);
  const visibleIncomeLimit = Math.max(1, Number(state.reportIncomeVisibleCount || 100));
  const visibleIncomeRows = incomeRows.slice(0, visibleIncomeLimit);
  return `
    <section class="section printable-report">
      <div class="card">
        <div class="print-report-header">
          <div>
            <p class="small muted">CryptoTax Sweden</p>
            <h2>${t("k4SectionOtherAssets")} - ${t("taxYear").toLowerCase()} ${escapeHtml(state.selectedTaxYear)}</h2>
            <p class="muted">${escapeHtml(state.auth.user?.email || t("signedInUser"))}</p>
          </div>
          <div class="print-report-meta">
            <span>${t("generated")} ${escapeHtml(formatDate(new Date().toISOString()))}</span>
            <span>${formatCount(transactions.length)} ${t("rows")}</span>
          </div>
        </div>
        <div class="grid grid-4 report-print-metrics">
          <div class="metric"><span>${t("k4Profit")}</span><strong>${formatSek(k4Totals.profit)}</strong></div>
          <div class="metric"><span>${t("k4Loss")}</span><strong>${formatSek(k4Totals.loss)}</strong></div>
          <div class="metric"><span>${t("otherIncome")}</span><strong>${formatSek(summary.income)}</strong></div>
          <div class="metric"><span>${t("rowsReviewed")}</span><strong>${formatCount(summary.count)}</strong></div>
        </div>
        <div class="report-print-section">
          <h3>${t("whatThisMeans")}</h3>
          <p>${escapeHtml(explanation)}</p>
        </div>
        <div class="report-print-section">
          <h3>${t("needsReview")}</h3>
          <ul>
            <li>${tr("zeroCostFallbackRows", { count: formatCount(missingBasisRows.length) })}</li>
            <li>${tr("manualSekPriceRows", { count: formatCount(missingPriceRows.length) })}${missingPriceAssets.length ? `: ${escapeHtml(missingPriceAssets.join(", "))}` : ""}.</li>
            <li>${tr("incomeRowsIncluded", { count: formatCount(incomeRows.length) })}</li>
            <li>${tr("disposalRowsIncluded", { count: formatCount(disposalRows.length) })}</li>
          </ul>
        </div>
        <div class="report-print-section">
          <h3>${t("k4SectionOtherAssets")}</h3>
          <p class="small muted">${t("k4SectionHelp")}</p>
          <div class="summary-strip discovery-strip k4-total-strip">
            <div class="metric"><span>${t("rows")}</span><strong>${formatCount(k4Rows.length)}</strong></div>
            <div class="metric"><span>${t("salePrice")}</span><strong>${formatSek(k4Totals.salePrice)}</strong></div>
            <div class="metric"><span>${t("costBasis")}</span><strong>${formatSek(k4Totals.costBasis)}</strong></div>
            <div class="metric"><span>${t("profitLoss")}</span><strong>${formatSek(k4Totals.profit)} / ${formatSek(k4Totals.loss)}</strong></div>
          </div>
          ${k4RowsTableTemplate(k4Rows)}
        </div>
        <div class="report-print-section">
          <h3>${t("otherIncomeNotK4")}</h3>
          <p class="small muted">${t("otherIncomeHelp")}</p>
          ${incomeBySource.length ? `
            <div class="summary-strip discovery-strip">
              ${incomeBySource.map((item) => `
                <div class="metric">
                  <span>${escapeHtml(item.source)}</span>
                  <strong>${formatSek(item.amount)}</strong>
                  <small class="muted">${formatCount(item.rows)} ${t("rows")}</small>
                </div>
              `).join("")}
            </div>
          ` : ""}
          <div class="screen-only">
            ${reportRowsTableTemplate(visibleIncomeRows)}
            ${incomeRows.length > visibleIncomeRows.length ? `
              <div class="table-footer-actions">
                <button class="btn btn-secondary" type="button" data-action="load-more-report-income">${t("loadMore")}</button>
                <span class="small muted">${formatCount(visibleIncomeRows.length)} / ${formatCount(incomeRows.length)} ${t("shown")}</span>
              </div>
            ` : `<p class="small muted table-count-note">${formatCount(visibleIncomeRows.length)} / ${formatCount(incomeRows.length)} ${t("shown")}</p>`}
          </div>
          <div class="print-only">
            ${reportRowsTableTemplate(incomeRows)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function k4RowsFromDisposals(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const salePrice = transactionProceedsSek(row);
    const costBasis = transactionCostBasisSek(row);
    const result = salePrice - costBasis;
    return {
      date: row.date || row.traded_at,
      source: transactionSourceDisplay(row),
      designation: k4Designation(row),
      amount: k4Amount(row),
      salePrice,
      costBasis,
      profit: Math.max(0, result),
      loss: Math.max(0, -result),
      status: transactionCostBasisStatus(row),
    };
  });
}

function summarizeK4Rows(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (summary, row) => {
      summary.salePrice += Number(row.salePrice || 0);
      summary.costBasis += Number(row.costBasis || 0);
      summary.profit += Number(row.profit || 0);
      summary.loss += Number(row.loss || 0);
      return summary;
    },
    { salePrice: 0, costBasis: 0, profit: 0, loss: 0 },
  );
}

function k4Designation(row) {
  const type = String(row?.type || "").toLowerCase();
  if (row?.isConversionGroup || type === "convert") {
    const from = row.fromAsset || row.from_asset_symbol || String(row.asset || row.asset_symbol || "").split("->")[0]?.trim();
    const to = row.toAsset || row.to_asset_symbol || String(row.asset || row.asset_symbol || "").split("->")[1]?.trim();
    return `${from || "Crypto"}${to ? ` byte till ${to}` : ""}`;
  }
  const asset = transactionAssetDisplay(row);
  return asset ? `${asset}` : "Kryptovaluta";
}

function k4Amount(row) {
  if (row?.isConversionGroup || String(row?.type || "").toLowerCase() === "convert") return formatQuantity(row.fromQuantity || row.from_quantity || row.quantity || 0);
  return transactionQuantityDisplay(row);
}

function k4RowsTableTemplate(rows) {
  if (!rows.length) return `<p class="muted">${t("noK4Rows")}</p>`;
  return `
    <div class="table-wrap k4-table-wrap">
      <table>
        <thead>
          <tr>
            <th>${t("date")}</th>
            <th>${t("source")}</th>
            <th>${t("designation")}</th>
            <th>${t("amount")}</th>
            <th>${t("salePrice")}</th>
            <th>${t("costBasis")}</th>
            <th>${currentLanguage() === "sv" ? "Vinst" : "Profit"}</th>
            <th>${currentLanguage() === "sv" ? "Förlust" : "Loss"}</th>
            <th>${t("status")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td data-label="${t("date")}">${formatDate(row.date)}</td>
              <td data-label="${t("source")}">${escapeHtml(row.source)}</td>
              <td data-label="${t("designation")}">${escapeHtml(row.designation)}</td>
              <td data-label="${t("amount")}">${escapeHtml(row.amount)}</td>
              <td data-label="${t("salePrice")}">${formatReportSek(row.salePrice)}</td>
              <td data-label="${t("costBasis")}">${formatReportSek(row.costBasis)}</td>
              <td data-label="${currentLanguage() === "sv" ? "Vinst" : "Profit"}">${row.profit > 0 ? formatReportSek(row.profit) : ""}</td>
              <td data-label="${currentLanguage() === "sv" ? "Förlust" : "Loss"}">${row.loss > 0 ? formatReportSek(row.loss) : ""}</td>
              <td data-label="${t("status")}">${escapeHtml(row.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function summarizeIncomeBySource(rows) {
  const bySource = new Map();
  rows.forEach((row) => {
    const source = transactionSourceDisplay(row);
    const current = bySource.get(source) || { source, amount: 0, rows: 0 };
    current.amount += transactionIncomeSek(row);
    current.rows += 1;
    bySource.set(source, current);
  });
  return [...bySource.values()].sort((left, right) => right.amount - left.amount);
}

function reportRowsTableTemplate(rows) {
  if (!rows.length) return `<p class="muted">${t("noRows")}</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${t("date")}</th>
            <th>${t("source")}</th>
            <th>${t("type")}</th>
            <th>${t("asset")}</th>
            <th>${t("quantity")}</th>
            <th>${t("proceeds")}</th>
            <th>${t("costBasis")}</th>
            <th>${t("income")}</th>
            <th>${t("status")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td data-label="${t("date")}">${formatDate(row.date || row.traded_at)}</td>
                  <td data-label="${t("source")}">${escapeHtml(transactionSourceDisplay(row))}</td>
                  <td data-label="${t("type")}">${escapeHtml(formatTransactionType(row.type || "trade"))}</td>
                  <td data-label="${t("asset")}">${escapeHtml(transactionAssetDisplay(row))}</td>
                  <td data-label="${t("quantity")}">${escapeHtml(transactionQuantityDisplay(row))}</td>
                  <td data-label="${t("proceeds")}">${formatReportSek(transactionProceedsSek(row))}</td>
                  <td data-label="${t("costBasis")}">${formatReportSek(transactionCostBasisSek(row))}</td>
                  <td data-label="${t("income")}">${formatReportSek(transactionIncomeSek(row))}</td>
                  <td data-label="${t("status")}">${escapeHtml(transactionCostBasisStatus(row))}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function billingTemplate() {
  const stripe = getStripeConfig();
  const plan = selectedPlan();
  const purchasedSlots = workspaceTransactionSlots();
  const workspaceCount = Array.isArray(state.transactions) ? state.transactions.length : 0;
  return `
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("transactionCountPricing")}</h2>
            <p class="muted">${t("transactionCountPricingHelp")}</p>
          </div>
          <span class="badge badge-blue">${t("stripe")} ${escapeHtml(stripe.mode || "test")}</span>
        </div>
        <div class="selected-plan-banner">
          <div>
            <span class="eyebrow">${t("transactionSlots")}</span>
            <strong>${formatCount(workspaceCount)} / ${formatCount(purchasedSlots)} ${t("transactions").toLowerCase()}</strong>
            <p class="muted small">${tr("paidPackagesAdd", { limit: formatCount(SELF_SERVICE_TRANSACTION_LIMIT), plan: escapeHtml(plan.name), slots: formatCount(plan.maxTransactions) })}</p>
          </div>
          <span class="badge ${plan.key === "starter" ? "badge-yellow" : "badge-blue"}">${formatMinorSek(plan.priceAmount)}</span>
        </div>
        <div class="grid grid-4">
          ${planCatalog.map(planCardTemplate).join("")}
        </div>
      </div>
    </section>
    <section class="section">
      <div class="card">
        <h2>${t("paymentState")}</h2>
        <p class="muted">${t("paymentStateHelp")}</p>
        <div class="button-row">
          <button class="btn btn-primary" type="button" data-action="checkout">${t("startCheckout")}</button>
          <button class="btn btn-secondary" type="button" data-action="billing">${t("manageBilling")}</button>
          <button class="btn btn-quiet" type="button" data-action="refresh-billing-history">${t("refreshInvoices")}</button>
        </div>
      </div>
    </section>
    ${billingHistoryTemplate()}
  `;
}

function billingHistoryTemplate() {
  const history = state.billingHistory || { loading: false, loaded: false, payments: [], invoices: [], error: "" };
  const payments = Array.isArray(history.payments) ? history.payments : [];
  const invoices = Array.isArray(history.invoices) ? history.invoices : [];
  const standaloneInvoices = invoices.filter((invoice) => !payments.some((payment) => payment.stripeInvoiceId && payment.stripeInvoiceId === invoice.id));
  return `
    <section class="section card">
      <div class="card-header">
        <div>
          <h2>${t("paymentHistory")}</h2>
          <p class="muted">${t("paymentHistoryHelp")}</p>
        </div>
        <button class="btn btn-secondary" type="button" data-action="refresh-billing-history">${history.loading ? t("refreshing") : t("refresh")}</button>
      </div>
      ${history.error ? `<p class="alert alert-error">${escapeHtml(history.error)}</p>` : ""}
      ${!history.loaded && !history.loading ? `<p class="muted">${t("refreshInvoicesAfterCheckout")}</p>` : ""}
      ${history.loading ? `<p class="muted">${t("fetchingStripeInvoices")}</p>` : ""}
      ${payments.length || standaloneInvoices.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>${t("package")}</th><th>${t("transactionSlots")}</th><th>${t("status")}</th><th>${t("total")}</th><th>${t("invoice")}</th><th>${t("date")}</th></tr></thead>
            <tbody>
              ${payments.map(paymentRowTemplate).join("")}
              ${standaloneInvoices.map(invoiceRowTemplate).join("")}
            </tbody>
          </table>
        </div>
      ` : history.loaded && !history.loading ? `<p class="muted">${t("noInvoices")}</p>` : ""}
    </section>
  `;
}

function paymentRowTemplate(payment) {
  const invoice = payment.invoice || {};
  const total = Number(payment.amountTotal || payment.amountPaid || invoice.total || invoice.amountPaid || 0);
  const slots = paymentTransactionSlots(payment);
  return `
    <tr>
      <td><strong>${escapeHtml(payment.planName || planName(payment.planKey))}</strong><span class="small muted block">${escapeHtml(payment.planKey || "")}</span></td>
      <td><strong>${formatCount(slots)}</strong><span class="small muted block">${t("transactions").toLowerCase()}</span></td>
      <td><span class="badge ${payment.status === "paid" ? "badge-blue" : "badge-yellow"}">${escapeHtml(payment.status === "paid" ? t("paid") : payment.status || t("pending"))}</span></td>
      <td>${formatMinorSek(total)}${Number(payment.taxAmount || 0) ? `<span class="small muted block">VAT ${formatMinorSek(payment.taxAmount)}</span>` : ""}</td>
      <td>${invoiceLinksTemplate(invoice, payment.stripeInvoiceId)}</td>
      <td>${payment.createdAt ? escapeHtml(formatDate(payment.createdAt)) : "&mdash;"}</td>
    </tr>
  `;
}

function invoiceRowTemplate(invoice) {
  return `
    <tr>
      <td><strong>${t("stripe")} ${t("invoice").toLowerCase()}</strong><span class="small muted block">${escapeHtml(invoice.number || invoice.id || "")}</span></td>
      <td>&mdash;</td>
      <td><span class="badge ${invoice.status === "paid" ? "badge-blue" : "badge-yellow"}">${escapeHtml(invoice.status === "paid" ? t("paid") : invoice.status || t("invoice"))}</span></td>
      <td>${formatMinorSek(Number(invoice.total || invoice.amountPaid || 0))}</td>
      <td>${invoiceLinksTemplate(invoice, invoice.id)}</td>
      <td>${invoice.created ? escapeHtml(formatDate(invoice.created)) : "&mdash;"}</td>
    </tr>
  `;
}

function invoiceLinksTemplate(invoice, fallbackId = "") {
  if (!invoice?.hostedInvoiceUrl && !invoice?.invoicePdf) {
    return fallbackId ? `<span class="small muted">${escapeHtml(fallbackId)}</span>` : "&mdash;";
  }
  return `
    <div class="link-row">
      ${invoice.hostedInvoiceUrl ? `<a href="${escapeHtml(invoice.hostedInvoiceUrl)}" target="_blank" rel="noreferrer">${t("openInvoice")}</a>` : ""}
      ${invoice.invoicePdf ? `<a href="${escapeHtml(invoice.invoicePdf)}" target="_blank" rel="noreferrer">PDF</a>` : ""}
    </div>
  `;
}

function planCardTemplate(plan) {
  return `
    <button class="plan-card ${state.selectedPlan === plan.key ? "is-selected" : ""}" type="button" data-plan="${plan.key}">
      <span class="badge ${plan.key === "starter" ? "badge-yellow" : "badge-blue"}">${escapeHtml(plan.badge)}</span>
      <h3>${escapeHtml(plan.name)}</h3>
      <p class="muted">${escapeHtml(plan.description)}</p>
      <div class="plan-price">${formatMinorSek(plan.priceAmount)}</div>
      <p class="small muted">${plan.maxTransactions.toLocaleString("sv-SE")} transactions. ${plan.includesAiRecovery ? "AI-assisted recovery included." : "Manual recovery notes included."}</p>
    </button>
  `;
}

function accountTemplate() {
  if (!state.auth.user) return authTemplate();
  const appSettings = state.auth.profile?.app_settings && typeof state.auth.profile.app_settings === "object" ? state.auth.profile.app_settings : {};
  const stablecoinFallbackEnabled = appSettings.stablecoin_cost_basis_fallback !== false;
  const selectedLanguage = appSettings.language === "sv" ? "sv" : "en";
  return `
    <section class="section">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>${t("account")}</h2>
            <p class="muted">${t("signedInAs")} ${escapeHtml(state.auth.user.email || t("supabaseUser"))}.</p>
          </div>
          <span class="badge">${t("active")}</span>
        </div>
        <form class="form-grid" data-form="profile">
          <div class="form-row">
            <label for="display-name">${t("displayName")}</label>
            <input id="display-name" name="displayName" value="${escapeHtml(state.auth.profile?.display_name || state.auth.user.email || "")}" />
          </div>
          <div class="form-row form-row-compact">
            <label for="profile-language">${t("language")}</label>
            <select id="profile-language" class="language-select" name="language">
              <option value="en" ${selectedLanguage === "en" ? "selected" : ""}>English</option>
              <option value="sv" ${selectedLanguage === "sv" ? "selected" : ""}>Svenska</option>
            </select>
          </div>
          <div class="settings-section">
            <div class="settings-section-header">
              <h3>${t("calculationSettings")}</h3>
              <p class="muted">${t("calculationSettingsHelp")}</p>
            </div>
            <label class="setting-row">
              <input class="setting-checkbox" type="checkbox" name="stablecoinCostBasisFallback" value="1" ${stablecoinFallbackEnabled ? "checked" : ""} />
              <span class="setting-checkbox-ui" aria-hidden="true"></span>
              <span>
                <strong>${t("useUsdPeg")}</strong>
                <small>${t("useUsdPegHelp")}</small>
              </span>
            </label>
          </div>
          <button class="btn btn-primary btn-fit" type="submit">${t("saveProfile")}</button>
        </form>
        <p class="trust-note">${t("profileTrust")}</p>
        <div class="section button-row">
          <button class="btn btn-secondary btn-danger" type="button" data-action="sign-out">${t("signOut")}</button>
        </div>
      </div>
    </section>
  `;
}

function authTemplate() {
  const isSignUp = state.authMode === "signup";
  return `
    <section class="section card auth-panel">
      <h2>${isSignUp ? t("createAccount") : t("signIn")}</h2>
      <p class="muted">${t("saveReportsBilling")}</p>
      <form class="form-grid" data-form="auth">
        ${isSignUp ? `<div class="form-row"><label for="auth-name">${t("name")}</label><input id="auth-name" name="displayName" autocomplete="name" aria-label="${t("name")}" /></div>` : ""}
        <div class="form-row">
          <label for="auth-email">${t("email")}</label>
          <input id="auth-email" name="email" type="email" autocomplete="email" aria-label="${t("email")}" required />
        </div>
        <div class="form-row">
          <label for="auth-password">${t("password")}</label>
          <input id="auth-password" name="password" type="password" autocomplete="${isSignUp ? "new-password" : "current-password"}" aria-label="${t("password")}" minlength="${PASSWORD_MIN_LENGTH}" required />
        </div>
        <button class="btn btn-primary" type="submit">${isSignUp ? t("createAccount") : t("signIn")}</button>
      </form>
      <p class="trust-note">${t("supabaseSignIn")}</p>
      <button class="btn btn-quiet" type="button" data-action="toggle-auth-mode">${isSignUp ? t("useExistingAccount") : t("createNewAccount")}</button>
    </section>
  `;
}

function loaderTemplate() {
  return `
    <div class="loader-overlay" role="status" aria-busy="true">
      <div class="loader-box">
        <div class="loader-pulse" aria-hidden="true"></div>
        <h3>${escapeHtml(state.loadingText || t("working"))}</h3>
        <p class="muted">${t("keepTabOpen")}</p>
      </div>
    </div>
  `;
}

function render() {
  root.innerHTML = appTemplate();
}

root.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    if (!state.auth.user) {
      setState({ error: "Sign in before opening the app workspace.", mobileOpen: false });
      return;
    }
    const route = routeButton.dataset.route;
    setState({ route, mobileOpen: false, error: "", notice: "" });
    if (route === "billing") loadBillingHistory({ silent: true });
    return;
  }
  const planButton = event.target.closest("[data-plan]");
  if (planButton) {
    if (!state.auth.user) {
      setState({ error: "Sign in before choosing a tier." });
      return;
    }
    const planKey = planButton.dataset.plan;
    setState({ selectedPlan: planKey, notice: `${planName(planKey)} tier selected.`, error: "" });
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton.dataset.action);
});

root.addEventListener("change", (event) => {
  if (event.target.matches("[data-field='selected-tax-year']")) {
    setState({ selectedTaxYear: Number(event.target.value), transactionVisibleCount: 100, reportIncomeVisibleCount: 100, selectedTransactionIds: [], notice: `Tax year ${event.target.value} selected.`, error: "" });
    hydrateWorkspaceFromDatabase({ silent: true });
  }
  if (event.target.matches("[data-field='transaction-type-filter']")) {
    setState({ transactionTypeFilter: String(event.target.value || "all"), transactionVisibleCount: 100, selectedTransactionIds: [], error: "", notice: "" });
  }
  if (event.target.matches("[data-field='transaction-asset-filter']")) {
    setState({ transactionAssetFilter: String(event.target.value || "all"), transactionVisibleCount: 100, selectedTransactionIds: [], error: "", notice: "" });
  }
  if (event.target.matches("[data-field='ai-import-asset']")) {
    toggleAiImportAsset(event.target.value, event.target.checked);
  }
  if (event.target.matches("[data-field='transaction-select-row']")) {
    toggleSelectedTransaction(event.target.value, event.target.checked);
  }
  if (event.target.matches("[data-field='transaction-select-visible']")) {
    toggleVisibleTransactions(event.target.checked);
  }
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === "auth") submitAuth(data);
  if (form.dataset.form === "profile") submitProfile(data);
  if (form.dataset.form === "binance") submitBinance(data);
  if (form.dataset.form === "opening") submitOpening(form, data);
  if (form.dataset.form === "ai-import") submitAiImport(form, data);
  if (form.dataset.form === "tax-import") submitTaxImport(form);
});

function handleAction(action) {
  const publicActions = new Set(["toggle-auth-mode", "focus-auth-signin", "focus-auth-signup"]);
  if (action === "toggle-theme") {
    setState({ theme: state.theme === "dark" ? "light" : "dark" });
    return;
  }
  if (action === "toggle-mobile-nav") {
    setState({ mobileOpen: !state.mobileOpen });
    return;
  }
  if (action === "close-mobile-nav") {
    setState({ mobileOpen: false });
    return;
  }
  if (action === "focus-auth-signin" || action === "focus-auth-signup") {
    setState({ authMode: action === "focus-auth-signup" ? "signup" : "signin", mobileOpen: false, error: "", notice: "" });
    window.requestAnimationFrame(() => {
      document.getElementById("signin")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("auth-email")?.focus();
    });
    return;
  }
  if (!state.auth.user && !publicActions.has(action)) {
    setState({ error: "Sign in before using CryptoTax Sweden." });
    return;
  }
  if (action === "toggle-auth-mode") setState({ authMode: state.authMode === "signin" ? "signup" : "signin", error: "" });
  if (action === "sign-out") withLoading("Signing out", () => signOut().then(() => setState({ notice: "Signed out." })));
  if (action === "start-discovery") runDiscovery();
  if (action === "start-api-import") startApiImport();
  if (action === "refresh-api-transactions") refreshApiTransactions();
  if (action === "preview-api-import") previewApiImport();
  if (action === "import-api-tax-year") importApiTaxYear();
  if (action === "checkout") createCheckout();
  if (action === "billing") openBillingPortal();
  if (action === "refresh-billing-history") loadBillingHistory();
  if (action === "connect-onboarding") openConnectOnboarding();
  if (action === "replace-binance-key") setState({ editingConnection: true, error: "", notice: "" });
  if (action === "cancel-replace-binance-key") setState({ editingConnection: false, error: "", notice: "" });
  if (action === "save-statement-draft") saveStatementDraft();
  if (action === "import-tax-year") importTaxYear();
  if (action === "approve-ai-import") approveAiImport();
  if (action === "recover-basis") recoverCostBasis();
  if (action === "generate-report") generateReport();
  if (action === "print-report") printYearlyReport();
  if (action === "download-k4-csv") downloadK4Csv();
  if (action === "copy-report") copyReportExplanation();
  if (action === "load-more-transactions") loadMoreTransactions();
  if (action === "load-more-report-income") loadMoreReportIncome();
  if (action === "select-visible-transactions") toggleVisibleTransactions(true);
  if (action === "clear-selected-transactions") setState({ selectedTransactionIds: [], error: "", notice: "" });
  if (action === "exclude-selected-transactions") excludeSelectedTransactions();
  if (action.startsWith("exclude-transaction:")) excludeTransactionDisplayRow(action.slice("exclude-transaction:".length));
  if (action.startsWith("edit-transaction:")) editTransactionDisplayRow(action.slice("edit-transaction:".length));
  if (action.startsWith("set-transaction-category:")) {
    setState({ transactionCategoryFilter: action.split(":")[1] || "all", transactionVisibleCount: 100, selectedTransactionIds: [], error: "", notice: "" });
  }
}

function submitAuth(data) {
  const email = String(data.email || "").trim();
  const password = String(data.password || "");
  const displayName = String(data.displayName || email).trim();
  if (!email || !password) {
    setState({ error: "Email and password are required." });
    return;
  }
  if (state.authMode === "signup" && password.length < PASSWORD_MIN_LENGTH) {
    setState({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
    return;
  }
  withLoading(state.authMode === "signup" ? "Creating account" : "Signing in", async () => {
    if (state.authMode === "signup") await signUpWithPassword(email, password, displayName);
    else await signInWithPassword(email, password);
    setState({ route: "dashboard", notice: "Signed in.", error: "" });
  });
}

function submitProfile(data) {
  if (!state.auth.user) {
    setState({ error: "Sign in before saving a profile." });
    return;
  }
  withLoading("Saving profile", async () => {
    await completeAppProfile({
      userId: state.auth.user.id,
      email: state.auth.user.email,
      displayName: data.displayName || state.auth.user.email,
      appSettings: {
        stablecoin_cost_basis_fallback: data.stablecoinCostBasisFallback === "1",
        language: data.language === "sv" ? "sv" : "en",
      },
    });
    setState({ notice: "Profile saved.", error: "" });
  });
}

function submitBinance(data) {
  const apiKey = String(data.apiKey || "").trim();
  const apiSecret = String(data.apiSecret || "").trim();
  const label = String(data.label || "Main Binance").trim();
  if (!apiKey || !apiSecret) {
    setState({ error: "Both Binance Tax API key fields are required for validation." });
    return;
  }
  withLoading("Validating Binance connection", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.connectBinance, { apiKey, apiSecret, label });
    setState({
      connection: {
        status: result.status || "connected",
        label: result.label || label,
        id: result.connectionId || result.connection_id || "",
        apiKeyHint: result.apiKeyHint || result.api_key_hint || "",
      },
      discovery: null,
      importPreview: null,
      editingConnection: false,
      notice: "Binance Tax API key validated.",
      error: "",
    });
  });
}

async function submitOpening(form, data) {
  const file = form.querySelector("input[type='file']")?.files?.[0];
  const statementDate = String(data.statementDate || yearStartStatementDate()).slice(0, 10);
  if (!file) {
    setState({ error: "Choose a statement PDF or CSV file first." });
    return;
  }
  if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    await extractPdfStatement(file, statementDate);
    return;
  }
  const text = await file.text();
  if (!text.trim()) {
    setState({ error: "The statement file was empty." });
    return;
  }
  const rows = sanitizeStoredOpeningBalances(
    parseCsv(text).map((row) => ({
      ...row,
      statementDate,
    })),
  );
  if (!rows.length) {
    setState({ error: "No valid statement rows found. Expected asset and quantity columns; priceUsd/valueUsd are optional evidence." });
    return;
  }
  setState({
    openingBalances: rows,
    statementDraft: { statementDate, sourceType: file ? "year_end_statement_csv" : "year_end_statement_manual", warnings: [] },
    notice: `${rows.length} year-start statement rows parsed for ${statementDate}. Review and save them.`,
    error: "",
  });
}

async function extractPdfStatement(file, statementDate) {
  if (!state.auth.user) {
    setState({ error: "Sign in before using AI statement extraction." });
    return;
  }
  await withLoading("Extracting statement PDF with AI", async () => {
    const storagePath = await uploadStatementPdf(file);
    const result = await callEdgeFunction(EDGE_FUNCTIONS.parseAccountStatement, {
      taxYear: state.selectedTaxYear,
      statementDate,
      fileName: file.name,
      storagePath,
    });
    const rows = sanitizeStoredOpeningBalances(
      (Array.isArray(result.rows) ? result.rows : []).map((row) => ({
        ...row,
        statementDate: result.statementDate || statementDate,
      })),
    );
    if (!rows.length) throw new Error("No statement rows were extracted from that PDF.");
    setState({
      openingBalances: rows,
      statementDraft: {
        statementDate: result.statementDate || statementDate,
        sourceType: result.sourceType || "ai_pdf_statement",
        sourceFilePath: result.sourceFilePath || storagePath,
        accountUid: result.accountUid || "",
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      },
      notice: `AI extracted ${rows.length} statement rows. Review them before saving.`,
      error: "",
    });
  });
}

async function uploadStatementPdf(file) {
  if (file.size > 10_000_000) throw new Error("Statement PDF is too large. Upload a PDF under 10 MB.");
  const client = await getSupabaseClient();
  const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-120) || "account-statement.pdf";
  const path = `${state.auth.user.id}/statements/${state.selectedTaxYear}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function submitAiImport(form, data) {
  const file = form.querySelector("input[name='csvFile']")?.files?.[0];
  if (!file) {
    setState({ error: "Choose a CSV file first." });
    return;
  }
  const sourceName = String(data.sourceName || "").trim() || file.name.replace(/\.[^.]+$/, "");
  await withLoading("Analyzing CSV with AI", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.analyzeCsvImport, {
      taxYear: state.selectedTaxYear,
      fileName: file.name,
      sourceName,
      csvText: await file.text(),
    });
    setState({
      aiImport: {
        fileName: result.fileName || file.name,
        sourceName: result.sourceName || sourceName,
        rowCount: Number(result.rowCount || 0),
        normalizedCount: Number(result.normalizedCount || 0),
        confidence: Number(result.confidence || 0.72),
        mapping: result.mapping || {},
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        sampleRows: Array.isArray(result.sampleRows) ? result.sampleRows : [],
        normalizedRows: Array.isArray(result.normalizedRows) ? result.normalizedRows : [],
        excludedAssets: [],
      },
      notice: `${formatCount(result.normalizedCount || 0)} rows mapped from ${file.name}. Review before importing.`,
      error: "",
    });
  });
}

function approveAiImport() {
  const draft = state.aiImport || {};
  const rows = aiImportIncludedRows(draft);
  if (!rows.length) {
    setState({ error: "Select at least one coin before approving import." });
    return;
  }
  const batchId = `csv:${state.selectedTaxYear}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const importedAt = new Date().toISOString();
  const importRows = rows.map((row) => {
    const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
    return {
      ...row,
      raw: {
        ...raw,
        csvImport: {
          batchId,
          sourceName: draft.sourceName || "AI CSV",
          fileName: draft.fileName || "CSV file",
          importedAt,
        },
      },
    };
  });
  withLoading("Importing AI-mapped CSV rows", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.importTaxYear, {
      taxYear: state.selectedTaxYear,
      source: "ai_csv",
      sourceName: draft.sourceName || "AI CSV",
      transactions: importRows,
    });
    const imported = Array.isArray(result.transactions) && result.transactions.length ? result.transactions : importRows;
    setState({
      transactions: mergeTransactions(state.transactions, imported),
      aiImport: null,
      route: "transactions",
      notice: `${formatCount(imported.length)} CSV rows imported into the tax ledger.${aiImportExcludedAssets(draft).size ? " Excluded coins were skipped." : ""}`,
      error: "",
    });
  });
}

function toggleAiImportAsset(asset, checked) {
  const draft = state.aiImport;
  if (!draft) return;
  const normalizedAsset = String(asset || "").toUpperCase();
  if (!normalizedAsset) return;
  const excluded = aiImportExcludedAssets(draft);
  if (checked) excluded.delete(normalizedAsset);
  else excluded.add(normalizedAsset);
  setState({
    aiImport: {
      ...draft,
      excludedAssets: [...excluded].sort(),
    },
    notice: checked ? `${normalizedAsset} will be included in this CSV import.` : `${normalizedAsset} will be skipped in this CSV import.`,
    error: "",
  });
}

function saveStatementDraft() {
  const openingBalances = selectedYearOpeningBalances();
  if (!openingBalances.length) {
    setState({ error: "Upload and extract a statement file before saving." });
    return;
  }
  const draft = selectedYearStatementDraft() || { statementDate: yearStartStatementDate(), sourceType: "year_end_statement_manual" };
  withLoading("Saving reviewed statement", async () => {
    await callEdgeFunction(EDGE_FUNCTIONS.processOpeningBalance, {
      taxYear: state.selectedTaxYear,
      statementDate: draft.statementDate || yearStartStatementDate(),
      rows: openingBalances,
      sourceType: draft.sourceType || "year_end_statement_manual",
      sourceFilePath: draft.sourceFilePath || null,
      confidence: draft.sourceType === "ai_pdf_statement" ? 0.76 : 0.9,
    });
    setState({
      statementDraft: null,
      notice: `Year-start statement saved for ${draft.statementDate || yearStartStatementDate()}. Cost basis remains unknown until recovered or entered separately.`,
      error: "",
    });
  });
}

async function submitTaxImport(form) {
  const discovery = selectedYearDiscovery();
  if (!discovery) {
    setState({ error: `Run discovery for tax year ${state.selectedTaxYear} before importing.` });
    return;
  }
  const file = form.querySelector("input[type='file']")?.files?.[0];
  if (!file) {
    setState({ error: "Choose a Binance transaction export CSV first." });
    return;
  }
  const rows = normalizeImportRows(parseCsv(await file.text()));
  if (!rows.length) {
    setState({ error: "No importable transaction rows found in that CSV." });
    return;
  }
  importTaxYear(rows);
}

function normalizeImportRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => {
      const rawDate = row.date || row.traded_at || row.Time || row.time || row.Date || "";
      const date = parseImportDate(rawDate);
      const asset = String(row.asset || row.asset_symbol || row.Coin || row.coin || row.Asset || "").trim().toUpperCase();
      const quantity = Number(row.quantity ?? row.Change ?? row.change ?? row.Amount ?? row.amount ?? 0);
      if (!date || !asset || !Number.isFinite(quantity) || quantity === 0) return null;
      const operation = String(row.type || row.Operation || row.operation || "transaction").trim();
      const normalizedType = normalizeImportType(operation, quantity);
      return {
        externalId:
          row.externalId ||
          row.external_id ||
          [row["User ID"] || row.userId || "", rawDate, row.Account || row.account || "", operation, asset, quantity, index].join("|"),
        date,
        type: normalizedType,
        asset,
        quantity: Math.abs(quantity),
        feeAsset: row.feeAsset || row.fee_asset_symbol || "",
        feeQuantity: Number(row.feeQuantity || row.fee_quantity || 0) || 0,
        proceedsSek: Number(row.proceedsSek || row.proceeds_sek || 0) || 0,
        costSek: Number(row.costSek || row.cost_basis_sek || 0) || 0,
        incomeSek: Number(row.incomeSek || row.income_sek || 0) || 0,
        confidence: Number(row.confidence || 0.62) || 0.62,
        notes: [operation, row.Remark || row.remark || ""].filter(Boolean).join(" - "),
        raw: row,
      };
    })
    .filter(Boolean);
}

function normalizeImportType(operation, quantity) {
  const lower = String(operation || "").toLowerCase();
  if (lower.includes("interest") || lower.includes("reward") || lower.includes("staking") || lower.includes("earn")) return "income";
  if (lower.includes("fee")) return "fee";
  if (lower.includes("withdraw")) return "withdrawal";
  if (lower.includes("deposit")) return "deposit";
  return quantity < 0 ? "outflow" : "inflow";
}

function parseImportDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const binanceMatch = raw.match(/^(\d{2})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (binanceMatch) {
    const [, yy, month, day, hour, minute, second] = binanceMatch;
    return new Date(2000 + Number(yy), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function runDiscovery() {
  if (state.connection.status !== "connected") {
    setState({ error: "Connect Binance before running discovery." });
    return;
  }
  withLoading("Running Binance discovery", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.runDiscovery, {
      taxYear: state.selectedTaxYear,
      connectionId: state.connection.id,
      statementYears: taxYears,
    });
    const recommendedPlan = result.recommendedPlan || result.recommended_plan || state.selectedPlan;
    const discovery = sanitizeStoredDiscovery({
      ...result,
      recommendedPlan,
      checkedAt: new Date().toISOString(),
    });
    const assetCount = discovery?.nonZeroAssetCount || discovery?.nonZeroAssets?.length || 0;
    const checkedCount = discovery?.productAreasChecked || discovery?.productCoverage?.length || 0;
    const foundCount = discovery?.productAreasFound || 0;
    setState({
      selectedPlan: recommendedPlan,
      discovery,
      importPreview: null,
      notice: `Discovery complete. ${formatCount(foundCount)}/${formatCount(checkedCount)} product areas returned data, with ${formatCount(assetCount)} non-zero spot assets. Recommended tier: ${planName(recommendedPlan)}.`,
      error: "",
    });
  });
}

function previewApiImport() {
  const discovery = selectedYearDiscovery();
  if (!discovery) {
    setState({ error: `Run discovery for tax year ${state.selectedTaxYear} before API import preview.` });
    return;
  }
  withLoading("Previewing Binance API rows", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.previewApiImport, {
      taxYear: state.selectedTaxYear,
      connectionId: state.connection.id,
    });
    const preview = sanitizeImportPreview({ ...result, taxYear: state.selectedTaxYear });
    const recommendedPlan = preview?.recommendedPlan?.key || state.selectedPlan;
    setState({
      importPreview: preview,
      selectedPlan: recommendedPlan,
      notice: `API preview complete. ${formatCount(preview?.rowCount || 0)} rows found for ${state.selectedTaxYear}; workspace package count is ${formatCount(preview?.workspaceRowCount || preview?.rowCount || 0)}. Package: ${planName(recommendedPlan)}.`,
      error: "",
    });
  });
}

function startApiImport() {
  const preview = selectedYearImportPreview();
  if (!preview) {
    previewApiImport();
    return;
  }
  const workspaceRowCount = Number(preview.workspaceRowCount || preview.rowCount || 0);
  const purchasedSlots = workspaceTransactionSlots();
  if (preview.requiresPayment && purchasedSlots >= workspaceRowCount) {
    importApiTaxYear();
    return;
  }
  if (preview.requiresPayment) {
    setState({
      route: "billing",
      notice: `This import needs ${formatCount(workspaceRowCount)} transaction slots. You currently have ${formatCount(purchasedSlots)}.`,
      error: "",
    });
    return;
  }
  importApiTaxYear();
}

function importApiTaxYear() {
  const preview = selectedYearImportPreview();
  if (!preview) {
    setState({ error: "Run API preview before importing from Binance API." });
    return;
  }
  withLoading(`Importing ${state.selectedTaxYear} from Binance API`, async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.importTaxYear, {
      taxYear: state.selectedTaxYear,
      connectionId: state.connection.id,
      planKey: preview.recommendedPlan?.key || state.selectedPlan,
      source: "binance_api",
    });
    const transactions = Array.isArray(result.transactions) && result.transactions.length ? result.transactions : state.transactions;
    setState({
      transactions,
      selectedPlan: preview.recommendedPlan?.key || state.selectedPlan,
      notice: `${formatCount(transactions.length)} Binance API rows imported into the tax ledger.`,
      error: "",
    });
  });
}

function refreshApiTransactions() {
  if (!state.connection.id) {
    setState({ error: "Connect Binance before refreshing transactions." });
    return;
  }
  withLoading(`Refreshing ${state.selectedTaxYear} transactions`, async () => {
    const preview = selectedYearImportPreview();
    const result = await callEdgeFunction(EDGE_FUNCTIONS.importTaxYear, {
      taxYear: state.selectedTaxYear,
      connectionId: state.connection.id,
      planKey: preview?.recommendedPlan?.key || state.selectedPlan,
      source: "binance_api",
    });
    const transactions = Array.isArray(result.transactions) && result.transactions.length ? result.transactions : state.transactions;
    const missingValuationCount = transactions.filter((item) => !transactionHasValuation(item)).length;
    setState({
      transactions,
      notice: missingValuationCount
        ? `${formatCount(transactions.length)} rows refreshed, but ${formatCount(missingValuationCount)} still need SEK valuation. Check Edge Function provisioning and Binance Vision/Riksbanken access.`
        : `${formatCount(transactions.length)} Binance API rows refreshed with SEK valuation.`,
      error: "",
    });
  });
}

function loadBillingHistory(options = {}) {
  const current = state.billingHistory || { payments: [], invoices: [], loaded: false, error: "" };
  setState({ billingHistory: { ...current, loading: true, error: "" } });
  return callEdgeFunction(EDGE_FUNCTIONS.listBillingHistory, {})
    .then((result) => {
      setState({
        billingHistory: {
          loading: false,
          loaded: true,
          payments: Array.isArray(result.payments) ? result.payments : [],
          invoices: Array.isArray(result.invoices) ? result.invoices : [],
          error: "",
        },
        notice: options.silent ? state.notice : "Billing history refreshed.",
        error: "",
      });
    })
    .catch((error) => {
      setState({
        billingHistory: { ...current, loading: false, loaded: true, error: error.message || "Could not fetch invoices." },
        notice: "",
      });
    });
}

function createCheckout() {
  withLoading("Creating Stripe Checkout", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.createCheckoutSession, {
      planKey: state.selectedPlan,
      taxYear: state.selectedTaxYear,
      successUrl: window.location.origin + window.location.pathname + "?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: window.location.origin + window.location.pathname + "?checkout=cancelled",
    });
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    setState({ notice: result.status === "free" ? "Free workspace package activated. You can import now." : "Checkout session created.", error: "" });
  });
}

function openBillingPortal() {
  withLoading("Opening billing portal", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.createBillingPortal, {
      returnUrl: window.location.origin + window.location.pathname,
    });
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    setState({ notice: "No billing portal URL returned.", error: "" });
  });
}

function openConnectOnboarding() {
  withLoading("Opening Connect onboarding", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.createConnectOnboarding, {
      refreshUrl: window.location.href,
      returnUrl: window.location.href,
    });
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    setState({ notice: "Connect account status refreshed.", error: "" });
  });
}

function importTaxYear(rows = []) {
  const discovery = selectedYearDiscovery();
  if (!discovery) {
    setState({ error: `Run discovery for tax year ${state.selectedTaxYear} before importing.` });
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    setState({ error: "Import needs a Binance transaction export CSV. Direct Binance tax-record fetching is not implemented in this app yet." });
    return;
  }
  withLoading(`Importing ${state.selectedTaxYear} activity`, async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.importTaxYear, {
      taxYear: state.selectedTaxYear,
      connectionId: state.connection.id,
      planKey: state.selectedPlan,
      transactions: rows,
    });
    const transactions = Array.isArray(result.transactions) && result.transactions.length ? result.transactions : state.transactions;
    setState({ transactions, notice: `${formatCount(transactions.length)} tax rows ready.`, error: "" });
  });
}

function recoverCostBasis() {
  const transactions = selectedYearTransactions();
  withLoading("Recovering cost basis", async () => {
    const result = await callEdgeFunction(EDGE_FUNCTIONS.recoverCostBasis, {
      taxYear: state.selectedTaxYear,
      transactions,
    });
    setState({
      report: {
        ...(state.report || {}),
        taxYear: state.selectedTaxYear,
        explanation: result.explanation || "Cost basis recovery completed with available opening balances and market evidence.",
      },
      notice: "Cost basis recovery completed.",
      error: "",
    });
  });
}

function generateReport() {
  const transactions = selectedYearTransactions();
  withLoading("Generating tax report", async () => {
    const summary = summarizeTransactions(transactions);
    try {
      const result = await callEdgeFunction(EDGE_FUNCTIONS.generateTaxReport, {
        taxYear: state.selectedTaxYear,
        planKey: state.selectedPlan,
        transactions,
      });
      setState({
        report: {
          id: result.reportId || result.report_id || "preview",
          taxYear: state.selectedTaxYear,
          explanation: result.explanation || result.auditExplanation || "",
          summary: result.summary || summary,
        },
        route: "reports",
        notice: t("reportGenerated"),
        error: "",
      });
    } catch (error) {
      const localReport = {
        id: "local-preview",
        taxYear: state.selectedTaxYear,
        explanation: `Preview only: ${transactions.length} rows for tax year ${state.selectedTaxYear} currently produce capital result ${formatSek(summary.gain)} and income ${formatSek(summary.income)}. Sign in and provision Supabase to persist the official report.`,
        summary,
      };
      setState({ report: localReport, route: "reports", notice: "Local preview generated. Server report needs Supabase provisioning.", error: "" });
    }
  });
}

async function copyReportExplanation() {
  const text = document.getElementById("report-explanation")?.innerText || "";
  const result = await copyText(text);
  setState({ notice: result.message, error: result.ok ? "" : result.message });
}

function printYearlyReport() {
  window.print();
}

function downloadK4Csv() {
  const calculationRows = taxCalculationRows(selectedYearTransactions());
  const disposalRows = calculationRows.filter((row) => transactionProceedsSek(row) > 0 || ["sell", "convert", "convert_out", "trade", "outflow"].includes(String(row.type || "").toLowerCase()));
  const k4Rows = k4RowsFromDisposals(disposalRows);
  if (!k4Rows.length) {
    setState({ error: "No K4 rows to export for the selected tax year." });
    return;
  }
  const headers = ["Datum", "Kalla", "Beteckning", "Antal/belopp", "Forsaljningspris SEK", "Omkostnadsbelopp SEK", "Vinst SEK", "Forlust SEK", "Status"];
  const csvRows = [
    headers,
    ...k4Rows.map((row) => [
      formatDate(row.date),
      row.source,
      row.designation,
      row.amount,
      Math.round(Number(row.salePrice || 0)),
      Math.round(Number(row.costBasis || 0)),
      Math.round(Number(row.profit || 0)),
      Math.round(Number(row.loss || 0)),
      row.status,
    ]),
  ];
  downloadTextFile(`cryptotax-k4-${state.selectedTaxYear}.csv`, csvRows.map((row) => row.map(csvCell).join(";")).join("\n"), "text/csv;charset=utf-8");
  setState({ notice: "K4 CSV exported.", error: "" });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(fileName, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

subscribeAuth((auth) => {
  state.auth = auth;
  render();
  if (auth.user) {
    hydrateWorkspaceFromDatabase({ silent: true });
  }
  if (auth.user && !state.billingHistory.loaded && !state.billingHistory.loading) {
    loadBillingHistory({ silent: true });
  }
});

render();
initAuthState();
