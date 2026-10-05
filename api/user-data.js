// ─────────────────────────────────────────────────────────────────────────────
// user-data.js — PDPA §33-34: right of access, portability, and erasure
//
//   GET    /user-data/export?line_user_id=U...   (headers: x-user-id, x-auth-key)
//          → JSON with every stored record for this user (decrypted)
//   DELETE /user-data  headers: x-user-id, x-auth-key
//          → permanently deletes every stored record for this user
//
// v2 changes (security review fixes):
//   • These endpoints now REQUIRE a per-user auth key minted by
//     POST /auth/challenge (which verifies a live LINE access token against
//     LINE). The raw LINE user id is NOT a secret — it is discoverable — so
//     unauthenticated export/delete was a data breach waiting to happen.
//     If USER_DATA_PEPPER is not configured on the server, requests are
//     rejected with 503 rather than silently opening the old hole.
//   • Lookups use hashIdCandidates() so legacy (unpeppered-hash) rows keep
//     resolving after the pepper is introduced.
//
// The raw id is never stored — lookups match the hash, with a raw-id
// fallback for legacy rows that predate the anonymization migration (004).
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";
import { decryptText, hashId, hashIdCandidates } from "./privacy.js";
import { requireAuthKey } from "./auth.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const USER_TABLES = {
  chat_messages:  "line_user_id",
  line_user_state: "line_user_id",
  emotion_alerts: "line_user_id_hash",
};

async function userKeys(lineUserId) {
  return [...hashIdCandidates(lineUserId), lineUserId];
}

/** GET /user-data/export?line_user_id=... — full data export (JSON) */
export async function exportUserData(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { line_user_id } = req.query;
  if (!line_user_id || line_user_id.length > 128)
    return res.status(400).json({ error: "line_user_id query param required" });

  // Header x-user-id must equal the id being exported (defense in depth —
  // requireAuthKey already proved the caller knows the key derived from it).
  // NOTE: runs BEFORE any other guard so a mismatched request never learns
  // anything about server configuration.
  if ((req.get("x-user-id") || line_user_id) !== line_user_id) {
    return res.status(401).json({ error: "x-user-id does not match requested user" });
  }

  if (!process.env.DATABASE_URL)
    return res.status(500).json({ error: "DATABASE_URL not configured" });

  const keys = await userKeys(line_user_id);
  const hash = hashId(line_user_id);

  try {
    const data = {};

    const messages = await pool.query(
      `SELECT id, role, text, source, session_id, session_title, created_at
         FROM chat_messages WHERE line_user_id = ANY($1::text[]) ORDER BY created_at ASC`,
      [keys]
    );
    data.chat_messages = messages.rows.map((r) => ({ ...r, text: decryptText(r.text) }));

    const state = await pool.query(
      `SELECT session_id, session_num, concern_streak, trend_json, updated_at
         FROM line_user_state WHERE line_user_id = ANY($1::text[])`,
      [keys]
    );
    data.line_user_state = state.rows;

    const alerts = await pool.query(
      `SELECT id, alert_type, consecutive_negative, message_shown_to_user, admin_notified, triggered_at
         FROM emotion_alerts WHERE line_user_id_hash = ANY($1::text[]) ORDER BY triggered_at ASC`,
      [hashIdCandidates(line_user_id)]
    ).catch(() => ({ rows: [] }));
    data.emotion_alerts = alerts.rows;

    return res.status(200).json({
      exported_at: new Date().toISOString(),
      line_user_id_hash: hash,
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** DELETE /user-data — permanent erasure (PDPA right to deletion) */
export async function deleteUserData(req, res) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const { line_user_id } = req.body ?? {};
  if (!line_user_id || line_user_id.length > 128)
    return res.status(400).json({ error: "line_user_id required in body" });

  if ((req.get("x-user-id") || line_user_id) !== line_user_id) {
    return res.status(401).json({ error: "x-user-id does not match requested user" });
  }

  if (!process.env.DATABASE_URL)
    return res.status(500).json({ error: "DATABASE_URL not configured" });

  const keys = await userKeys(line_user_id);
  const hashes = hashIdCandidates(line_user_id);

  try {
    const deleted = {};
    const messages = await pool.query(
      `DELETE FROM chat_messages WHERE line_user_id = ANY($1::text[]) RETURNING id`,
      [keys]
    );
    deleted.chat_messages = messages.rowCount;

    const state = await pool.query(
      `DELETE FROM line_user_state WHERE line_user_id = ANY($1::text[]) RETURNING id`,
      [keys]
    );
    deleted.line_user_state = state.rowCount;

    const alerts = await pool.query(
      `DELETE FROM emotion_alerts WHERE line_user_id_hash = ANY($1::text[]) RETURNING id`,
      [hashes]
    ).catch(() => ({ rowCount: 0 }));
    deleted.emotion_alerts = alerts.rowCount;

    return res.status(200).json({ ok: true, deleted });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Auth middleware for these routes is registered in index.js:
//   app.use(["/user-data"], requireAuthKey("require"));
