async function callUpstream(method, upstream, body) {
  return fetch(upstream, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TOKENMIND_API_KEY}`,
      "User-Agent": "Mozilla/5.0 (compatible; jaikrajok-proxy/1.0)",
      Accept: "application/json",
    },
    body: method !== "GET" ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
}

export default async function handler(req, res) {
  const path = req.url.replace(/^\/thaillm/, "");
  const base = (process.env.TOKENMIND_BASE_URL || "https://tokenmind.pathumma.in.th").replace(/\/$/, "");
  const upstream = `${base}${path.startsWith("/v1") && base.endsWith("/v1") ? path.slice(3) : path}`;
  console.log(`[thaillm→tokenmind] → ${req.method} ${upstream}`);
  try {
    let response = await callUpstream(req.method, upstream, req.body);
    // single retry on 502/503 (Cloudflare transient)
    if ((response.status === 502 || response.status === 503) && req.method !== "GET") {
      console.warn(`[thaillm] ${response.status} — retrying in 2s`);
      await new Promise(r => setTimeout(r, 2000));
      response = await callUpstream(req.method, upstream, req.body);
    }
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      console.error(`[thaillm] upstream ${response.status}:`, text.slice(0, 300));
    }
    res.status(response.status).json(data);
  } catch (err) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    if (!isTimeout) console.error("[thaillm] upstream error:", err?.message);
    res.status(504).json({ error: isTimeout ? "ThaiLLM (TokenMind) timeout" : "ThaiLLM upstream error" });
  }
}
