import nodemailer from "nodemailer";
import { randomInt } from "crypto";
import { createHash } from "crypto";
import { isSmtpConfigured, getSmtpCredentials } from "./notify.js";

// Simple in-memory store: email -> { hash, expires, attempts }
// (the app is PDPA-minimal; OTP lives 10 minutes, no DB table needed)
const otpStore = new Map();

function hashCode(email, code) {
  return createHash("sha256").update(`${code}:${email}:${process.env.OTP_PEPPER || "jkj"}`).digest("hex");
}

/** Verify an OTP server-side. Returns null on success, or a reason string. */
export function verifyOtp(email, code) {
  const rec = otpStore.get(email);
  if (!rec) return "not_found";
  if (Date.now() > rec.expires) { otpStore.delete(email); return "expired"; }
  if (rec.attempts >= 5) return "too_many_attempts";
  if (rec.hash !== hashCode(email, String(code))) {
    rec.attempts += 1;
    return "mismatch";
  }
  otpStore.delete(email); // single-use
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body ?? {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email)))
    return res.status(400).json({ error: "Valid email required" });

  // The server mints the OTP. Any client-supplied `otp` is ignored —
  // otherwise the client could pick its own code and "verify" it later.
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  otpStore.set(String(email).toLowerCase(), {
    hash: hashCode(String(email).toLowerCase(), otp),
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  });
  if (otpStore.size > 10_000) otpStore.clear();

  if (!isSmtpConfigured()) {
    return res.status(503).json({
      error: "SMTP not configured",
      hint: "Admin must set APP_SMTP_USER + APP_SMTP_PASS (Gmail app password) in GitLab CI/CD variables.",
    });
  }

  const { user, pass } = getSmtpCredentials();

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    await transporter.sendMail({
      from: `"JaiKraJok" <${user}>`,
      to: email,
      subject: "รหัส OTP สำหรับ JaiKraJok",
      text: `รหัส OTP ของคุณคือ: ${otp}\n\nรหัสนี้จะหมดอายุใน 10 นาที`,
      html: `<p>รหัส OTP ของคุณคือ: <strong>${otp}</strong></p><p>รหัสนี้จะหมดอายุใน 10 นาที</p>`,
    });

    res.status(200).json({
      ok: true,
      // dev-only echo so demos work without a real inbox; never in production
      dev_otp: process.env.NODE_ENV === "production" ? undefined : otp,
    });
  } catch (err) {
    console.error("[send-otp] send failed:", err.message);
    res.status(502).json({ error: "Email send failed" });
  }
}