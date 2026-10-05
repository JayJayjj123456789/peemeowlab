import nodemailer from "nodemailer";
import { isSmtpConfigured, getSmtpCredentials } from "./notify.js";

// Escape user-controlled strings before they enter the HTML email body.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Only same-origin https links may be mailed as the approval button —
// anything else turns this endpoint into a phishing relay from our domain.
function isSafeApprovalLink(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    return h === "team07.aiforthai.in.th" || h.endsWith(".aiforthai.in.th") || h === "localhost";
  } catch {
    return false;
  }
}

// Bounded transport — a hung SMTP connection must not hold the request open.
function makeTransport(user, pass) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to_email, child_name, approval_link, verification_code } = req.body ?? {};
  if (!to_email || !EMAIL_RE.test(String(to_email)))
    return res.status(400).json({ error: "Valid to_email required" });
  if (!approval_link || !isSafeApprovalLink(approval_link))
    return res.status(400).json({ error: "approval_link must be an https aiforthai.in.th URL" });

  if (!isSmtpConfigured()) {
    return res.status(503).json({
      error: "SMTP not configured",
      hint: "Admin must set APP_SMTP_USER + APP_SMTP_PASS (Gmail app password) in GitLab CI/CD variables.",
    });
  }

  const { user, pass } = getSmtpCredentials();

  try {
    const transporter = makeTransport(user, pass);

    await transporter.sendMail({
      from: `"JaiKraJok" <${user}>`,
      to: to_email,
      subject: "ขอความยินยอมผู้ปกครอง — JaiKraJok",
      html: `
        <div style="font-family: 'Noto Sans Thai', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1A1208; border-bottom: 2px solid #FF3366; padding-bottom: 10px;">ขอความยินยอมผู้ปกครอง</h2>

          <p>สวัสดีครับ/ค่ะ ผู้ปกครองของ <strong>${esc(child_name ?? "บุตรหลานของคุณ")}</strong></p>

          <p>บุตรหลานของคุณต้องการใช้งาน <strong>JaiKraJok</strong> ซึ่งเป็นแอปพลิเคชันสุขภาพจิตสำหรับนักเรียน</p>

          <div style="background-color: #E3F2FD; border: 2px solid #2196F3; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <p style="margin: 0 0 10px 0; color: #1565C0; font-weight: 600;">รหัสยืนยันของคุณคือ:</p>
            <div style="font-family: monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #1A1208; background: white; padding: 15px; border: 2px solid #2196F3; border-radius: 4px; margin: 10px 0;">
              ${esc(verification_code ?? "")}
            </div>
            <p style="margin: 10px 0 0 0; color: #1565C0; font-size: 12px;">กรุณาบอกรหัสนี้กับบุตรหลานเพื่อยืนยันการใช้งาน</p>
          </div>

          <p style="margin: 20px 0;">กรุณากดปุ่มด้านล่างเพื่ออนุมัติการใช้งาน:</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${esc(approval_link)}" style="display: inline-block; background-color: #2E7D32; color: white; padding: 15px 40px; text-decoration: none; font-weight: 700; border-radius: 4px; font-size: 16px;">
              อนุมัติการใช้งาน JaiKraJok
            </a>
          </div>

          <hr style="border: none; border-top: 1px solid #E0E0E0; margin: 30px 0;">

          <p style="color: #666; font-size: 13px; line-height: 1.6;">
            <strong>เกี่ยวกับ JaiKraJok:</strong><br>
            ข้อมูลทั้งหมดจัดเก็บในอุปกรณ์ของผู้ใช้เท่านั้น ไม่มีการส่งข้อมูลส่วนบุคคลออกนอกระบบ
            ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)
          </p>

          <p style="color: #999; font-size: 12px; margin-top: 20px;">
            หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลนี้
          </p>
        </div>
      `,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[guardian-email] send failed:", err.message);
    res.status(502).json({ error: "Email send failed" });
  }
}
