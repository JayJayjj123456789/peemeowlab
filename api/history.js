import pg from "pg";
import { encryptText, decryptText, hashId } from "./privacy.js";

// Shared connection pool — reused across requests
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Ensure the chat_messages table exists on first use
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           SERIAL PRIMARY KEY,
      line_user_id TEXT        NOT NULL,
      role         TEXT        NOT NULL,
      text         TEXT        NOT NULL,
      source       TEXT        NOT NULL DEFAULT 'web',
      session_id   TEXT,
      session_title TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (line_user_id, created_at ASC);
  `);
  tableReady = true;
}

// Shared-secret gate — WEB_API_SECRET set → client must send x-app-token.
// Unset → open (dev mode). Protects both reading others' history (ID
// enumeration) and forging rows into victims' sessions.
function checkAuth(req) {
  const secret = process.env.WEB_API_SECRET;
  if (!secret) return true;
  return req.headers["x-app-token"] === secret;
}

const ALLOWED_ROLES = new Set(["user", "bot"]);
const safeStr = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL)
    return res.status(500).json({ error: "DATABASE_URL not configured" });
  if (!checkAuth(req))
    return res.status(401).json({ error: "Unauthorized" });

  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ error: "DB init failed: " + err.message });
  }

  // POST /api/history — save a web chat message (validated)
  if (req.method === "POST") {
    const { line_user_id, role, text, session_id, session_title } = req.body ?? {};
    const userId = safeStr(line_user_id, 128);
    const msgText = safeStr(text, 4000);
    if (!userId || !ALLOWED_ROLES.has(role) || !msgText)
      return res.status(400).json({ error: "Invalid fields" });

    const sid = safeStr(session_id, 128);
    const stitle = safeStr(session_title, 128);

    try {
      await pool.query(
        `INSERT INTO chat_messages
           (line_user_id, role, text, source, session_id, session_title)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          hashId(userId),                          // § anonymized — never raw
          role,
          encryptText(msgText),                    // § AES-256-GCM
          "web",                                   // server-controlled, not client
          sid,
          stitle,
        ]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET /api/history?line_user_id=U... — fetch chat history grouped by session
  if (req.method === "GET") {
    const lineUserId = req.query.line_user_id;
    if (!lineUserId || lineUserId.length > 128)
      return res.status(400).json({ error: "Missing or invalid line_user_id" });

    try {
      // Match the hashed id first; the raw id is a fallback for legacy rows
      // that predate the anonymization migration (004).
      const { rows } = await pool.query(
        `SELECT role, text, source, created_at, session_id, session_title
           FROM chat_messages
          WHERE line_user_id = ANY($1::text[])
          ORDER BY created_at ASC
          LIMIT 200`,
        [[hashId(lineUserId), lineUserId]]
      );

      for (const row of rows) row.text = decryptText(row.text); // § decrypt AES-256-GCM

      // Group by session_id — rows without session_id go into a "LINE Bot History" fallback
      const sessionMap = new Map();
      for (const row of rows) {
        const sid = row.session_id || "__line__";
        if (!sessionMap.has(sid)) {
          sessionMap.set(sid, {
            session_id: sid,
            session_title: row.session_title || (sid === "__line__" ? "LINE Bot History" : "สนทนา"),
            messages: [],
          });
        }
        sessionMap.get(sid).messages.push(row);
      }

      return res.status(200).json({ sessions: Array.from(sessionMap.values()) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}