export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const { code, redirect_uri } = JSON.parse(body || "{}");
      if (!code || !redirect_uri) {
        res.status(400).json({ error: "Missing code or redirect_uri" });
        return;
      }

      const clientId = process.env.LINE_LOGIN_CHANNEL_ID || process.env.VITE_LINE_CHANNEL_ID || process.env.LINE_CHANNEL_ID;
      const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;

      if (!clientId || !clientSecret) {
        res.status(500).json({ error: "LINE Channel configuration missing on server" });
        return;
      }

      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const data = await response.json();
      if (!data.access_token) {
        res.status(response.status).json(data);
        return;
      }

      // Fetch LINE profile server-side so the browser never needs connect-src api.line.me
      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const profile = await profileRes.json();

      res.status(profileRes.status).json({ ...data, profile });
    } catch (err) {
      console.error("[line-token] exchange failed:", err.message);
    res.status(500).json({ error: "Token exchange failed" });
    }
  });
}
