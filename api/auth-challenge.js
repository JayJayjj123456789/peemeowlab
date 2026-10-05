// ─────────────────────────────────────────────────────────────────────────────
// auth-challenge.js — POST /auth/challenge
//
// Client sends { access_token } — a LINE access token it already obtained via
// LINE Login. The server verifies it directly with LINE's /v2/verify endpoint
// and, on success, returns the per-user auth key used by the x-auth-key
// header on /user-data, /history, etc.
//
// Security properties:
//   • The token is checked against LINE, not trusted from the client.
//   • The derived key is useless without the exact user id it was minted for.
//   • The server pepper (USER_DATA_PEPPER) never leaves the process.
//   • strictLimiter applies (10 req / 15 min / IP) — registered in index.js.
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { access_token: accessToken } = req.body ?? {};
  if (!accessToken || typeof accessToken !== "string" || accessToken.length > 2048) {
    return res.status(400).json({ error: "access_token required" });
  }

  try {
    // Verify the token with LINE — it must be live AND belong to a channel.
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const verify = await verifyRes.json().catch(() => ({}));

    if (!verifyRes.ok || !verify.client_id) {
      return res.status(401).json({ error: "Invalid or expired LINE token" });
    }

    // Confirm the token belongs to OUR LINE Login channel.
    const clientId = process.env.LINE_LOGIN_CHANNEL_ID || process.env.VITE_LINE_CHANNEL_ID;
    if (clientId && verify.client_id !== String(clientId)) {
      return res.status(401).json({ error: "Token issued for a different channel" });
    }

    // Token is valid — fetch the profile to get the verified user id.
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok || !profile.userId) {
      return res.status(401).json({ error: "Could not load LINE profile" });
    }

    // Derive the per-user auth key server-side (pepper stays secret).
    const { deriveAuthKey } = await import("./auth.js");
    const authKey = deriveAuthKey(profile.userId);
    if (!authKey) {
      return res.status(503).json({
        error: "Auth not configured on server",
        hint: "Set APP_USER_DATA_PEPPER in GitLab CI/CD variables.",
      });
    }

    return res.status(200).json({ user_id: profile.userId, auth_key: authKey });
  } catch (err) {
    console.error("[auth-challenge] failed:", err?.message);
    return res.status(502).json({ error: "LINE verification unavailable" });
  }
}
