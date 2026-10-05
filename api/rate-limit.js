// ─────────────────────────────────────────────────────────────────────────────
// rate-limit.js — Rate limiting per guiderule / proposal claim
//
// express-rate-limit counts requests per client IP. Behind the hackathon
// reverse proxy + our nginx, every request carries X-Forwarded-For, so the
// api must `app.set("trust proxy", 1)` (done in index.js).
//
// Exemptions:
//   /health, /webhook, /webhooks/line — LINE platform pings these
//   /admin-db                      — admin dashboard (SSE + polling)
// ─────────────────────────────────────────────────────────────────────────────
import rateLimit from "express-rate-limit";

// /admin-db removed from exemptions — it is secret/cookie-authenticated now,
// and its 2s SSE polling is exactly what a rate limiter exists to bound.
const EXEMPT_PREFIXES = ["/health", "/webhook", "/webhooks/line"];

function isExempt(req) {
  return EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"));
}

/** Default: 120 requests / 15 min per client IP. */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: isExempt,
  message: { error: "Too many requests — please try again later." },
});

/** Stricter for expensive / abuse-prone endpoints: 10 / 15 min. */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests on this endpoint — please try again later." },
});