// ─────────────────────────────────────────────────────────────────────────────
// auth.js — HMAC authentication for user-facing endpoints
//
// The LINE user ID alone is NOT a secret (it is discoverable via chat, the
// LINE app "ID search" feature, etc.). Endpoints that read or erase personal
// data must therefore require proof of a shared secret derived from a server
// pepper:
//
//   auth_key = base64url(HMAC-SHA256(pepper, "auth-key:" + line_user_id))
//
// The client derives nothing — it calls POST /auth/challenge with its LINE
// access token (the same token LINE Login already returns), and the server
// verifies the token directly against LINE and returns the auth_key. The
// raw user id + auth_key then travel as headers on export/delete/history
// calls. No pepper ever leaves the server; the auth_key is user-specific so
// it is useless for any other account.
//
// Env: USER_DATA_PEPPER (APP_USER_DATA_PEPPER in CI). If absent, a warning is
// logged once and endpoints fall back to legacy behaviour (open access) so a
// deploy without the new var degrades instead of breaking the web app.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

/** Derive the per-user auth key from the server-side pepper. */
export function deriveAuthKey(lineUserId) {
  const pepper = process.env.USER_DATA_PEPPER || process.env.APP_USER_DATA_PEPPER;
  if (!pepper) return null;
  return createHmac("sha256", pepper).update(`auth-key:${lineUserId}`).digest("base64url");
}

/** Constant-time string comparison; false if either side is missing. */
export function safeEqual(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Express middleware factory. mode "require" rejects without a valid key;
 * "optional" only enforces when the pepper is configured (graceful deploy).
 */
export function requireAuthKey(mode = "require") {
  return (req, res, next) => {
    const pepper = process.env.USER_DATA_PEPPER || process.env.APP_USER_DATA_PEPPER;
    if (!pepper) {
      // No pepper configured: only "require" mode rejects; "optional" lets
      // the request through (legacy behaviour, deploy-safe).
      if (mode === "require") {
        return res.status(503).json({
          error: "Auth not configured on server (USER_DATA_PEPPER missing)",
        });
      }
      return next();
    }
    const key = req.get("x-auth-key");
    const uid = req.get("x-user-id") || req.query.line_user_id || req.body?.line_user_id;
    if (!uid) return res.status(401).json({ error: "x-user-id header required" });
    if (!safeEqual(key, deriveAuthKey(uid))) {
      return res.status(401).json({ error: "Invalid x-auth-key" });
    }
    next();
  };
}
