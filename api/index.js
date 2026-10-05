import "dotenv/config";
import express from "express";
import webhookHandler from "./webhook.js";
import historyHandler, { historyAuth } from "./history.js";
import ssenseHandler from "./ssense.js";
import vajaHandler from "./vaja.js";
import tavilyHandler from "./tavily.js";
import searchHandler from "./search.js";
import pathummaHandler from "./pathumma.js";
import typhoonHandler from "./typhoon.js";
import thaillmHandler from "./thaillm.js";
import ptmAsrHandler from "./ptm-asr.js";
import lineTokenHandler from "./line-token.js";
import sendOtpHandler, { verifyOtp } from "./send-otp.js";
import guardianEmailHandler from "./guardian-email.js";
import adminDbHandler from "./admin-db.js";
import authChallengeHandler from "./auth-challenge.js";
import { exportUserData, deleteUserData } from "./user-data.js";
import { requireAuthKey } from "./auth.js";
import { globalLimiter, strictLimiter } from "./rate-limit.js";
import { runMigrations } from "./migrate.js";
import pg from "pg";

// Strip APP_ prefix injected by CI so handlers read env vars normally
// e.g. APP_DATABASE_URL → DATABASE_URL
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("APP_")) {
    const unprefixed = key.slice(4);
    if (!process.env[unprefixed]) process.env[unprefixed] = value;
  }
}

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 })
  : null;

const app = express();

// Rate limiting counts real client IPs. The api sits behind two proxies
// (hackathon reverse proxy → nginx container), so trust 2 proxy hops:
// req.ip = left-most X-Forwarded-For entry = the real client.
app.set("trust proxy", 2);
app.use(globalLimiter);

// ── Security headers (applied to every API response) ─────────────────────────
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Narrow CSP for API — JSON/HTML responses only, no asset loading
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});

// ── Health check (required by CI pipeline) ──────────────────────────────────
// Verifies the API is up AND the database is reachable, so a broken
// migration or DB outage is caught by the pipeline instead of silently
// returning ok while the bot misbehaves.
app.get("/health", async (_req, res) => {
  try {
    if (pool) await pool.query("SELECT 1");
    return res.json({ status: "ok", db: "ok" });
  } catch (err) {
    return res.status(503).json({ status: "degraded", db: "error" });
  }
});

// ── DB health detail — exercises migration 002's db_health view ─────────────
app.get("/db-health", async (_req, res) => {
  if (!pool) return res.status(503).json({ status: "no-db-configured" });
  try {
    const result = await pool.query("SELECT COUNT(*) AS n FROM db_health");
    return res.json({ status: "ok", tables: Number(result.rows[0]?.n || 0) });
  } catch (err) {
    console.error("[health] degraded:", err?.message);
    return res.status(503).json({ status: "degraded" });
  }
});

// ── Raw-body handlers — register BEFORE express.json() ───────────────────────
// webhook reads raw body itself for LINE signature verification
app.post("/webhook", webhookHandler);
app.post("/webhooks/line", webhookHandler);  // canonical URL: /api/webhooks/line

// line-token reads raw body manually via req.on("data").
// strictLimiter is attached inline: the global strictLimiter app.use() below
// (line ~108) never fires for this route because Express matches this
// handler first — verified live (12 rapid POSTs, no 429 before this fix).
app.post("/line-token", strictLimiter, lineTokenHandler);

// ── Streaming proxy handlers — pipe req body directly, BEFORE json parser ────
app.all(["/pathumma", "/pathumma/*"], (req, res) => {
  req.url = "/api" + req.url;
  pathummaHandler(req, res);
});

app.all(["/typhoon", "/typhoon/*"], (req, res) => {
  req.url = "/api" + req.url;
  typhoonHandler(req, res);
});

app.all(["/ptm-asr", "/ptm-asr/*"], (req, res) => {
  req.url = "/api" + req.url;
  ptmAsrHandler(req, res);
});

// ── JSON body parser ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Stricter limits on abuse-prone / expensive endpoints ──────────────────────
app.use(["/send-otp", "/guardian-email", "/line-token"], strictLimiter);

// ── JSON-body handlers ────────────────────────────────────────────────────────
// /history carries per-user auth headers when USER_DATA_PEPPER is configured
// (optional mode so existing web deploys keep working until the pepper is set).
app.all("/history", historyAuth, historyHandler);
app.post("/ssense", ssenseHandler);
app.post("/vaja", vajaHandler);
app.post("/tavily", tavilyHandler);       // kept for backward compat
app.post("/search", searchHandler);       // SearXNG primary + Tavily fallback
app.all(["/thaillm", "/thaillm/*"], thaillmHandler);
app.post("/send-otp", sendOtpHandler);

// POST /verify-otp — server-side OTP verification (single-use, 10-min TTL,
// 5 attempts). The client no longer decides what a valid code is.
app.post("/verify-otp", (req, res) => {
  const { email, code } = req.body ?? {};
  if (!email || !code)
    return res.status(400).json({ error: "Missing email or code" });
  const reason = verifyOtp(String(email).toLowerCase(), String(code));
  if (reason)
    return res.status(401).json({ ok: false, error: reason });
  res.status(200).json({ ok: true });
});

app.post("/guardian-email", guardianEmailHandler);

// ── Auth challenge — mints per-user auth keys after LINE token verification ──
app.post("/auth/challenge", strictLimiter, authChallengeHandler);

// ── Admin DB inspection (read-only, secret-protected) ────────────────────────
app.get("/admin-db", adminDbHandler);

// ── PDPA data rights: export / erasure ───────────────────────────────────────
// Auth: x-user-id + x-auth-key headers (minted by POST /auth/challenge).
// The raw LINE id is not a secret — these endpoints must never be open.
app.use(["/user-data", "/user-data/*"], requireAuthKey("require"));
app.get("/user-data/export", exportUserData);
app.delete("/user-data", deleteUserData);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;

// Fail closed in production: an unsigned webhook is a forged webhook. Missing
// LINE_CHANNEL_SECRET would silently accept fake messages (review finding #3).
if (process.env.NODE_ENV === "production" && !process.env.LINE_CHANNEL_SECRET) {
  console.error("FATAL: LINE_CHANNEL_SECRET is not set — refusing to start in production (webhooks would be unauthenticated).");
  process.exit(1);
}

runMigrations()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`JaiKraJok API listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup migration failed — aborting:", err.message);
    process.exit(1);
  });
