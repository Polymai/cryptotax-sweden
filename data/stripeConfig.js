// Polymai runtime Stripe config.
// Frontend-safe only: publishable key, Connect client ID, mode, redirect defaults, and function URL.
// Never add Stripe secret keys, webhook secrets, restricted keys, or backend credentials here.
(function () {
  const config = Object.freeze({
    mode: "test",
    publishableKey: "pk_test_51TS3spRndyGeYiPN1ggn5xv2S9j498dTFjPEpx3uBcxjB2HNidQMf2LJ0vcTzso4JzbVVfFwHQf8IYFTZ88Y4xNm00gTQrWc28",
    connectClientId: "ca_UVJpPMLXXKDt2D0AfRrNodn9Y73VWs4Q",
    stripeConnectClientId: "ca_UVJpPMLXXKDt2D0AfRrNodn9Y73VWs4Q",
    functionsBaseUrl: "https://pfnlebwkbhblytpvaokd.supabase.co/functions/v1",
    apiFunctionName: "app687-cryptotax-sweden-api",
    checkoutFunctionName: "app687-cryptotax-sweden-api",
    billingPortalFunctionName: "app687-cryptotax-sweden-api",
    webhookFunctionName: "app687-cryptotax-sweden-stripe-webhook",
    webhookRouterFunctionName: "polymai-stripe-webhook-router",
    defaultSuccessUrl: "",
    defaultCancelUrl: "",
    defaultPriceIds: [],
  });
  window.__POLYMAI_STRIPE_CONFIG__ = config;
})();
