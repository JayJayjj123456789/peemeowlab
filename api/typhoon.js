export default async function handler(req, res) {
  const path = req.url.replace("/api/typhoon", "");
  const contentType = req.headers["content-type"] ?? "";

  try {
    // Buffer the full body first — piping req directly into undici fetch
    // causes connection resets on large JSON (typhoon-ocr) and multipart bodies
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    const response = await fetch(`https://api.opentyphoon.ai${path}`, {
      method: req.method,
      headers: {
        // Forward original Content-Type (preserves multipart boundary)
        "Content-Type": contentType || "application/json",
        Authorization: `Bearer ${process.env.TYPHOON_ASR_KEY}`,
      },
      body: req.method !== "GET" ? rawBody : undefined,
      signal: AbortSignal.timeout(90000),
    });

    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("[typhoon] upstream error:", err?.message);
    if (!isTimeout) console.error("[typhoon] upstream error:", err?.message);
    res.status(504).json({ error: isTimeout ? "Typhoon upstream timeout" : "Typhoon upstream error" });
  }
}
