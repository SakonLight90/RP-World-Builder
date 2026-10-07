/*
 * The platform's principles, as code.
 *
 * A local project that asks for no money, shows no ads and does no tracking is not a matter
 * of good intentions: it is a matter of dependencies, and an analytics package or an API key
 * for a paid service would end up in the project without anyone noticing.
 *
 * So the principles are **verifiable**: `principles.test.ts` reads the source and fails on
 * a contradiction.
 */

export const PRINCIPLES = [
  {
    id: "gratis",
    claim: "Nothing is paid and there is no purchase mechanism at all.",
  },
  {
    id: "locale",
    claim: "Everything runs on the user's machine: no service of ours in between.",
  },
  {
    id: "senza-pubblicita",
    claim: "No advertising, no banners, no affiliate links.",
  },
  {
    id: "senza-tracciamento",
    claim: "No telemetry, no analytics, no user tracking.",
  },
  {
    id: "senza-store",
    claim: "No store, no mandatory account, nothing can be bought in the app.",
  },
  {
    id: "dati-locali",
    claim: "The data stays local and can be deleted with one command.",
  },
] as const;

/** Allowed dependencies. Every entry is a choice, not an inheritance: telemetry cannot come in. */
export const ALLOWED_DEPENDENCIES = new Set([
  // runtime
  "@opencode-ai/sdk",
  "better-sqlite3",
  "fastify",
  "yaml",
  "zod",
  // interface. Next and React contact no external service on their own, and Next's telemetry
  // is disabled in `next.config`.
  "next",
  "react",
  "react-dom",
  // Next's compiler in WebAssembly: runs on any processor, used when the native binary does
  // not load
  "@next/swc-wasm-nodejs",
  // development
  "@biomejs/biome",
  "@types/better-sqlite3",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "tsx",
  "typescript",
  "vitest",
]);

/**
 * Words that must not appear in application source. Each carries its reason: a ban without an
 * explanation gets removed at the first useful opportunity.
 */
export const FORBIDDEN_IN_SOURCE = [
  { pattern: /google-analytics/i, why: "usage analytics" },
  { pattern: /gtag|googletagmanager/i, why: "usage analytics" },
  { pattern: /segment\.com|@segment/i, why: "usage analytics" },
  { pattern: /sentry\.io|@sentry/i, why: "error reporting to a third party" },
  { pattern: /mixpanel|amplitude|heap\.io/i, why: "usage analytics" },
  {
    pattern: /plausible\.(io|com|js)|@plausible|cdn\.plausible|plausible\/analytics|matomo|umami/i,
    why: "usage analytics",
  },
  { pattern: /posthog/i, why: "usage analytics" },
  { pattern: /stripe|paddle|lemonsqueezy|gumroad|paypal/i, why: "payments" },
  { pattern: /\bstripe\b.*checkout|in-app.?purchase/i, why: "in-app purchase" },
  { pattern: /googlesyndication|doubleclick|adsbygoogle|adsense/i, why: "advertising" },
  { pattern: /carbonads|adsterra|popads|hilltopads/i, why: "advertising" },
  { pattern: /navigator\.sendBeacon|new\s+Image\(\).*beacon/i, why: "telemetry" },
  { pattern: /track\w*Event|logEvent|captureException/i, why: "tracking" },
] as const;
