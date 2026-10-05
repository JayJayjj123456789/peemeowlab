export default async function handler(req, res) {
  const path = req.url.replace("/api/pathumma", "");

  // FormData endpoints (VQA, AudioQA) — stream the body through as-is
  const contentType = req.headers["content-type"] ?? "";
  const isForm = contentType.includes("multipart/form-data");

  try {
    // Buffer the full body first — piping req directly into undici fetch
    // causes connection resets on multipart form-data (binary) payloads
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    const upstream = await fetch(`https://api.aiforthai.in.th${path}`, {
      method: req.method,
      headers: isForm
        ? { "Content-Type": contentType, Apikey: process.env.PATHUMMA_API_KEY, "X-lib": "jaikrajok-web" }
        : { "Content-Type": "application/json", Apikey: process.env.PATHUMMA_API_KEY, "X-lib": "jaikrajok-web" },
      body: req.method !== "GET" ? rawBody : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    if (!isTimeout) console.error("[pathumma] upstream error:", err?.message);
    res.status(504).json({ error: isTimeout ? "pathumma upstream timeout" : "pathumma upstream error" });
  }
}
