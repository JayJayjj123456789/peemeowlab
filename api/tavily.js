export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    console.error("[tavily] proxy error:", err?.message);
    if (!res.headersSent) res.status(502).json({ error: "Upstream unavailable" });
  }
}
