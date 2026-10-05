export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text } = req.body ?? {};
  if (!text || typeof text !== "string")
    return res.status(400).json({ error: "Missing text" });

  const params = new URLSearchParams({ text: text.slice(0, 2000) });
  try {
    const response = await fetch("https://api.aiforthai.in.th/ssense", {
      method: "POST",
      headers: {
        "Apikey": process.env.PATHUMMA_API_KEY ?? process.env.AIFORTHAI_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    console.error("[ssense] proxy error:", err?.message);
    if (!res.headersSent) res.status(502).json({ error: "Upstream unavailable" });
  }
}
