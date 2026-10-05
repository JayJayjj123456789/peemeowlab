/**
 * admin-db.js — read-only DB inspection endpoint (HTML dashboard)
 *
 * GET /admin-db?secret=<ADMIN_SECRET>&tab=messages&page=2
 *     (first visit authenticates + issues an admin_sess cookie; afterwards
 *      plain /admin-db?tab=… works without the secret in the URL)
 *
 * tabs: messages | emotions | homework | alerts
 * page: 1-based, 20 rows per page
 */

import pg from "pg";
import { createHash, timingSafeEqual } from "crypto";
import { decryptText } from "./privacy.js";

const PAGE_SIZE = 20;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Constant-time secret comparison (review finding #4 — the old `!==`
 * comparison leaked the secret byte-by-byte through timing).
 */
function secretMatches(provided) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Issue a short-lived session cookie so the secret stops appearing in every
 * URL (nginx logs, browser history, Referer). First visit authenticates with
 * ?secret=…; subsequent navigation uses the cookie alone.
 */
function issueSession(res) {
  const token = createHash("sha256")
    .update(`${process.env.ADMIN_SECRET}:${Date.now()}:${Math.random()}`)
    .digest("hex");
  sessions.set(token, Date.now() + 4 * 60 * 60 * 1000); // 4h
  res.setHeader("Set-Cookie", `admin_sess=${token}; HttpOnly; SameSite=Strict; Path=/api/admin-db; Max-Age=14400`);
}

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}, 10 * 60 * 1000).unref();

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("GET only");

  const url = new URL(req.url, "http://x");
  const providedSecret = url.searchParams.get("secret");
  const cookie = req.headers.cookie || "";
  const sessToken = /(?:^|;\s*)admin_sess=([a-f0-9]{64})/.exec(cookie)?.[1];

  const authenticated =
    secretMatches(providedSecret) ||
    (sessToken && sessions.has(sessToken) && sessions.get(sessToken) > Date.now());

  if (!authenticated) {
    return res.status(401).send("<h2>401 Unauthorized</h2>");
  }
  // Fresh secret visit: upgrade to a session cookie so later links/refreshes
  // don't carry the secret in the URL.
  if (secretMatches(providedSecret) && !sessToken) {
    issueSession(res);
  }

  if (!process.env.DATABASE_URL)
    return res.status(500).send("<h2>DATABASE_URL not configured</h2>");

  // SSE endpoint for real-time updates
  if (req.query.stream === "true") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");  // Tell nginx: DO NOT buffer this response
    res.flushHeaders();

    const sendUpdate = async () => {
      try {
        const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) AS count FROM chat_messages`);
        const { rows: latestMessages } = await pool.query(`
          SELECT id, line_user_id, role, source,
                 to_char(created_at AT TIME ZONE 'Asia/Bangkok','DD Mon HH24:MI:SS') AS time,
                 LEFT(text,100) AS preview
          FROM chat_messages ORDER BY created_at DESC LIMIT 5
        `);
        for (const m of latestMessages) m.preview = decryptText(m.preview);

        res.write(`data: ${JSON.stringify({ count, latestMessages })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    };

    // Send initial update
    await sendUpdate();

    // Send updates every 2 seconds
    const interval = setInterval(sendUpdate, 2000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });

    return;
  }

  // Override the global API CSP (default-src 'none') for this HTML page.
  // Inline <style> is required; no external scripts or frames needed.
  res.setHeader("Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");

  const tab  = ["messages","emotions","homework","alerts"].includes(req.query.tab)
               ? req.query.tab : "messages";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  try {
    // ── counts & meta ──────────────────────────────────────────────────────
    const tablesRes = await pool.query(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const tables = tablesRes.rows.map(r => r.tablename);
    const counts = {};
    for (const t of tables) {
      const r = await pool.query(`SELECT COUNT(*) AS n FROM "${t}"`);
      counts[t] = parseInt(r.rows[0].n, 10);
    }
    const { rows: [{ db_size }] } = await pool.query(
      `SELECT pg_size_pretty(pg_database_size('app')) AS db_size`
    );

    // ── paginated data for active tab ──────────────────────────────────────
    let tabRows = [], totalRows = 0;

    if (tab === "messages" && tables.includes("chat_messages")) {
      totalRows = counts["chat_messages"] ?? 0;
      const r = await pool.query(`
        SELECT id, line_user_id, role, source, session_title,
               to_char(created_at AT TIME ZONE 'Asia/Bangkok','DD Mon HH24:MI:SS') AS time,
               LEFT(text,200) AS preview
        FROM chat_messages ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`, [PAGE_SIZE, offset]);
      for (const row of r.rows) row.preview = decryptText(row.preview);
      tabRows = r.rows;
    } else if (tab === "emotions" && tables.includes("emotion_events")) {
      totalRows = counts["emotion_events"] ?? 0;
      const r = await pool.query(`
        SELECT id, source_type, face_emotion, sentiment_label,
               ROUND(sentiment_score::numeric,2) AS sentiment_score,
               combined_emotion, LEFT(combined_summary,120) AS summary,
               to_char(detected_at AT TIME ZONE 'Asia/Bangkok','DD Mon HH24:MI:SS') AS time
        FROM emotion_events ORDER BY detected_at DESC
        LIMIT $1 OFFSET $2`, [PAGE_SIZE, offset]);
      tabRows = r.rows;
    } else if (tab === "homework" && tables.includes("homework_events")) {
      totalRows = counts["homework_events"] ?? 0;
      const r = await pool.query(`
        SELECT id, subject_detected, LEFT(ocr_text,80) AS ocr_text,
               LEFT(ai_response,120) AS ai_response, emotion_at_time,
               to_char(created_at AT TIME ZONE 'Asia/Bangkok','DD Mon HH24:MI:SS') AS time
        FROM homework_events ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`, [PAGE_SIZE, offset]);
      tabRows = r.rows;
    } else if (tab === "alerts" && tables.includes("emotion_alerts")) {
      totalRows = counts["emotion_alerts"] ?? 0;
      const r = await pool.query(`
        SELECT id, alert_type, consecutive_negative, admin_notified,
               line_user_id_hash,
               LEFT(message_shown_to_user,100) AS msg,
               to_char(triggered_at AT TIME ZONE 'Asia/Bangkok','DD Mon HH24:MI:SS') AS time,
               resolved_at
        FROM emotion_alerts ORDER BY triggered_at DESC
        LIMIT $1 OFFSET $2`, [PAGE_SIZE, offset]);
      tabRows = r.rows;
    }

    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    const safePage   = Math.min(page, totalPages);

    // ── helpers ────────────────────────────────────────────────────────────
    // Links rely on the admin_sess cookie — no secret in URLs (review #4).
    const link = (t, p) =>
      `?tab=${t}&page=${p}`;

    const tabBtn = (id, label) =>
      `<a href="${link(id,1)}" class="tab${tab===id?" active":""}">${label}</a>`;

    const pagerBtn = (p, label, disabled) =>
      disabled
        ? `<span class="pg-btn disabled">${label}</span>`
        : `<a href="${link(tab,p)}" class="pg-btn">${label}</a>`;

    // page numbers around current
    const pageNums = () => {
      const lo = Math.max(1, safePage-2), hi = Math.min(totalPages, safePage+2);
      let s2 = "";
      if (lo > 1) s2 += pagerBtn(1,"1",false) + (lo>2?'<span class="pg-btn disabled">…</span>':"");
      for (let i=lo;i<=hi;i++)
        s2 += `<a href="${link(tab,i)}" class="pg-btn${i===safePage?" current":""}">${i}</a>`;
      if (hi < totalPages) s2 += (hi<totalPages-1?'<span class="pg-btn disabled">…</span>':"") + pagerBtn(totalPages,totalPages,false);
      return s2;
    };

    // ── table HTML builders ────────────────────────────────────────────────
    const allTableRows = tables.map(t =>
      `<tr><td>${t}</td><td class="num">${counts[t].toLocaleString()}</td></tr>`
    ).join("");

    const buildRows = () => {
      if (!tabRows.length)
        return `<tr><td colspan="9" style="color:#64748b;padding:20px;text-align:center">No data</td></tr>`;
      if (tab === "messages") return tabRows.map((r,i) => `
        <tr class="${i%2===0?"even":"odd"}">
          <td class="num">${r.id}</td>
          <td class="mono">${esc(r.line_user_id)}</td>
          <td><span class="badge badge-${r.role}">${r.role}</span></td>
          <td><span class="badge badge-${r.source}">${r.source}</span></td>
          <td>${esc(r.session_title??"—")}</td>
          <td class="mono time">${r.time}</td>
          <td class="preview">${esc(r.preview)}</td>
        </tr>`).join("");
      if (tab === "emotions") return tabRows.map((r,i) => `
        <tr class="${i%2===0?"even":"odd"}">
          <td class="num">${r.id}</td>
          <td><span class="badge badge-src-${r.source_type}">${r.source_type}</span></td>
          <td>${esc(r.face_emotion??"—")}</td>
          <td>${r.sentiment_label?`<span class="badge badge-${r.sentiment_label}">${r.sentiment_label} ${r.sentiment_score??""}</span>`:"—"}</td>
          <td>${esc(r.combined_emotion??"—")}</td>
          <td class="preview">${esc(r.summary??"—")}</td>
          <td class="mono time">${r.time}</td>
        </tr>`).join("");
      if (tab === "homework") return tabRows.map((r,i) => `
        <tr class="${i%2===0?"even":"odd"}">
          <td class="num">${r.id}</td>
          <td>${esc(r.subject_detected??"—")}</td>
          <td class="preview">${esc(r.ocr_text??"—")}</td>
          <td class="preview">${esc(r.ai_response??"—")}</td>
          <td>${esc(r.emotion_at_time??"—")}</td>
          <td class="mono time">${r.time}</td>
        </tr>`).join("");
      if (tab === "alerts") return tabRows.map((r,i) => `
        <tr class="${i%2===0?"even":"odd"}">
          <td class="num">${r.id}</td>
          <td><span class="badge badge-alert">${esc(r.alert_type)}</span></td>
          <td class="num">${r.consecutive_negative??"—"}</td>
          <td class="mono">${esc(r.line_user_id_hash ? r.line_user_id_hash.slice(0,16)+"…" : "—")}</td>
          <td class="preview">${esc(r.msg??"—")}</td>
          <td>${r.admin_notified?"✅":"—"}</td>
          <td class="mono time">${r.time}</td>
          <td style="color:${r.resolved_at?"#6ee7b7":"#f87171"}">${r.resolved_at?"resolved":"open"}</td>
        </tr>`).join("");
    };

    const thead = () => {
      if (tab==="messages")  return `<tr><th>ID</th><th>User ID</th><th>Role</th><th>Source</th><th>Session</th><th>Time (BKK)</th><th>Preview</th></tr>`;
      if (tab==="emotions")  return `<tr><th>ID</th><th>Source</th><th>Face</th><th>Sentiment</th><th>Combined</th><th>Summary</th><th>Time (BKK)</th></tr>`;
      if (tab==="homework")  return `<tr><th>ID</th><th>Subject</th><th>OCR Text</th><th>AI Response</th><th>Emotion</th><th>Time (BKK)</th></tr>`;
      if (tab==="alerts")    return `<tr><th>ID</th><th>Type</th><th>Streak</th><th>User (hash)</th><th>Message Shown</th><th>Notified</th><th>Time (BKK)</th><th>Status</th></tr>`;
    };

    // ── final HTML ─────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DB Admin — team07</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI','Noto Sans Thai',sans-serif;background:#0f1117;color:#e2e8f0;padding:24px;font-size:14px}
    h1{font-size:1.4rem;font-weight:700;color:#fff;margin-bottom:4px}
    .sub{color:#64748b;font-size:12px;margin-bottom:20px}
    a{color:#7dd3fc;text-decoration:none}a:hover{text-decoration:underline}
    /* stat cards */
    .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}
    .card{background:#1e2030;border:1px solid #2d3250;border-radius:10px;padding:14px 20px;min-width:140px}
    .card .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
    .card .value{font-size:1.5rem;font-weight:700;color:#7dd3fc}
    /* layout */
    .layout{display:flex;gap:20px;align-items:flex-start}
    /* sidebar */
    .sidebar{width:220px;flex-shrink:0}
    .sidebar h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:8px}
    .sidebar table{width:100%;border-collapse:collapse;background:#1e2030;border-radius:8px;overflow:hidden;font-size:13px}
    .sidebar td{padding:7px 12px;border-bottom:1px solid #252840}
    .sidebar tr:last-child td{border-bottom:none}
    .sidebar td:last-child{text-align:right;color:#7dd3fc;font-variant-numeric:tabular-nums}
    /* main panel */
    .main{flex:1;min-width:0}
    /* tabs */
    .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
    .tab{background:#1e2030;border:1px solid #2d3250;border-radius:6px;padding:6px 16px;font-size:12px;color:#94a3b8;cursor:pointer}
    .tab:hover{border-color:#7dd3fc;color:#7dd3fc;text-decoration:none}
    .tab.active{background:#2d3250;border-color:#7dd3fc;color:#fff;font-weight:600}
    /* section header */
    .sec-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .sec-hdr h2{font-size:1rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
    .sec-hdr .pg-info{font-size:12px;color:#64748b}
    /* table */
    table{width:100%;border-collapse:collapse;background:#1e2030;border-radius:10px;overflow:hidden}
    thead tr{background:#2d3250}
    th{padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:600}
    td{padding:8px 12px;border-bottom:1px solid #252840;vertical-align:top}
    tr:last-child td{border-bottom:none}
    tr.odd{background:#222440}
    .num{text-align:right;font-variant-numeric:tabular-nums;color:#7dd3fc}
    .mono{font-family:'Cascadia Code','Fira Code',monospace;font-size:12px;color:#a5b4fc}
    .time{color:#64748b;font-size:12px;white-space:nowrap}
    .preview{color:#cbd5e1;max-width:280px;word-break:break-word;font-size:13px}
    /* badges */
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    .badge-user{background:#1d4ed8;color:#bfdbfe}
    .badge-bot{background:#065f46;color:#6ee7b7}
    .badge-web{background:#713f12;color:#fde68a}
    .badge-line{background:#166534;color:#bbf7d0}
    .badge-positive{background:#065f46;color:#6ee7b7}
    .badge-negative{background:#7f1d1d;color:#fca5a5}
    .badge-neutral{background:#1e3a5f;color:#93c5fd}
    .badge-alert{background:#78350f;color:#fde68a}
    .badge-src-face{background:#4c1d95;color:#c4b5fd}
    .badge-src-text{background:#1e3a5f;color:#93c5fd}
    .badge-src-voice{background:#064e3b;color:#6ee7b7}
    .badge-src-combined{background:#1e293b;color:#e2e8f0}
    /* pager */
    .pager{display:flex;gap:4px;align-items:center;margin-top:14px;flex-wrap:wrap}
    .pg-btn{background:#1e2030;border:1px solid #2d3250;border-radius:5px;padding:4px 10px;font-size:12px;color:#94a3b8;cursor:pointer}
    .pg-btn:hover{border-color:#7dd3fc;color:#7dd3fc;text-decoration:none}
    .pg-btn.current{background:#2d3250;border-color:#7dd3fc;color:#fff;font-weight:700}
    .pg-btn.disabled{color:#334155;cursor:default;pointer-events:none}
    .footer{font-size:11px;color:#334155;margin-top:24px}
    /* live indicator */
    .live-badge{display:inline-flex;align-items:center;gap:6px;background:#065f46;color:#6ee7b7;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.04em}
    .live-dot{width:8px;height:8px;background:#6ee7b7;border-radius:50%;animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .live-updates{background:#1e2030;border:1px solid #2d3250;border-radius:8px;padding:12px;margin-top:14px}
    .live-updates h3{font-size:12px;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
    .live-msg{background:#222440;border-left:3px solid #7dd3fc;padding:8px 12px;margin-bottom:6px;border-radius:4px;font-size:12px}
    .live-msg:last-child{margin-bottom:0}
    .live-msg .badge{margin-right:6px}
    .live-msg .time{color:#64748b;font-size:11px;margin-left:8px}
  </style>
</head>
<body>

<h1>🗄️ JaiKraJok — DB Admin</h1>
<p class="sub">team07 · PostgreSQL 16 · read-only · <a href="${link(tab,safePage)}">↻ refresh</a> · <span class="live-badge"><span class="live-dot"></span>LIVE</span></p>

<div class="cards">
  <div class="card"><div class="label">DB Size</div><div class="value">${db_size}</div></div>
  <div class="card"><div class="label">Tables</div><div class="value">${tables.length}</div></div>
  <div class="card"><div class="label">Messages</div><div class="value">${(counts["chat_messages"]??0).toLocaleString()}</div></div>
  <div class="card"><div class="label">Emotions</div><div class="value">${(counts["emotion_events"]??0).toLocaleString()}</div></div>
  <div class="card"><div class="label">Alerts</div><div class="value">${(counts["emotion_alerts"]??0).toLocaleString()}</div></div>
</div>

<div class="layout">
  <div class="sidebar">
    <h2>All Tables</h2>
    <table><tbody>${allTableRows}</tbody></table>
  </div>

  <div class="main">
    <div class="tabs">
      ${tabBtn("messages","💬 Chat Messages")}
      ${tabBtn("emotions","😊 Emotion Events")}
      ${tabBtn("homework","📚 Homework")}
      ${tabBtn("alerts","⚠️ Alerts")}
    </div>

    <div class="sec-hdr">
      <h2>${tab==="messages"?"Chat Messages":tab==="emotions"?"Emotion Events":tab==="homework"?"Homework Events":"Emotion Alerts"}</h2>
      <span class="pg-info">Page ${safePage} / ${totalPages} &nbsp;·&nbsp; ${totalRows.toLocaleString()} rows</span>
    </div>

    <table>
      <thead>${thead()}</thead>
      <tbody>${buildRows()}</tbody>
    </table>

    <div class="pager">
      ${pagerBtn(safePage-1,"← Prev", safePage<=1)}
      ${pageNums()}
      ${pagerBtn(safePage+1,"Next →", safePage>=totalPages)}
    </div>
  </div>
</div>

<div class="live-updates" id="liveUpdates">
  <h3>🔴 Live Updates (Last 5 messages)</h3>
  <div id="liveMessages">Connecting...</div>
</div>

<p class="footer">Generated at ${new Date().toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p>

<script>
(function() {
  const liveMessagesEl = document.getElementById('liveMessages');
  const eventSource = new EventSource('?stream=true');

  eventSource.onmessage = function(e) {
    try {
      const data = JSON.parse(e.data);

      if (data.error) {
        liveMessagesEl.innerHTML = '<div style="color:#f87171">Error: ' + data.error + '</div>';
        return;
      }

      if (data.latestMessages && data.latestMessages.length > 0) {
        const html = data.latestMessages.map(msg => {
          const roleClass = msg.role === 'user' ? 'badge-user' : 'badge-bot';
          const sourceClass = msg.source === 'line' ? 'badge-line' : 'badge-web';
          return \`<div class="live-msg">
            <span class="badge \${roleClass}">\${msg.role}</span>
            <span class="badge \${sourceClass}">\${msg.source}</span>
            <span style="color:#cbd5e1">\${escapeHtml(msg.preview)}</span>
            <span class="time">\${msg.time}</span>
          </div>\`;
        }).join('');
        liveMessagesEl.innerHTML = html;

        // Update total count in header if visible
        const countCard = document.querySelector('.cards .card:nth-child(3) .value');
        if (countCard && data.count) {
          countCard.textContent = data.count.toLocaleString();
        }
      } else {
        liveMessagesEl.innerHTML = '<div style="color:#64748b">No messages yet</div>';
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  eventSource.onerror = function() {
    liveMessagesEl.innerHTML = '<div style="color:#fbbf24">Connection lost. Reconnecting...</div>';
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
</script>

</body>
</html>`;

    res.setHeader("Content-Type","text/html; charset=utf-8");
    return res.status(200).send(html);

  } catch (err) {
    return res.status(500).send(`<pre style="color:red;padding:20px">Error: ${esc(err.message)}</pre>`);
  }
}

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
