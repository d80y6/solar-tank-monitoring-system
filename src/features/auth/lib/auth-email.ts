import nodemailer from "nodemailer";

import { canLogOtpInDevelopment, isProductionLikeEnvironment } from "./auth-config";

type OtpDeliveryResult =
  | { delivered: true; delivery: "email" }
  | { delivered: true; delivery: "log" }
  | { delivered: false; delivery: "none"; reason: string };

type EmailDeliveryResult = OtpDeliveryResult;
type EmailTemplateKind = "otp" | "action";

function getSmtpPort(): number {
  const parsed = Number(process.env.SMTP_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 587;
}

function hasSmtpConfig(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim() &&
      process.env.SMTP_FROM?.trim(),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHtmlEmail({
  actionLabel,
  actionUrl,
  code,
  intro,
  title,
  warning,
}: {
  actionLabel?: string;
  actionUrl?: string;
  code?: string;
  intro: string;
  title: string;
  warning: string;
}): string {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeWarning = escapeHtml(warning);
  const safeActionUrl = actionUrl ? escapeHtml(actionUrl) : null;
  const safeActionLabel = actionLabel ? escapeHtml(actionLabel) : null;
  const safeCode = code ? escapeHtml(code) : null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:#f5faf8;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5faf8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px;border-bottom:1px solid #eef2f7;">
                <div style="font-size:18px;font-weight:700;color:#18181b;">FTM</div>
                <div style="margin-top:4px;font-size:13px;color:#64748b;">Fuel Tank Management</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#18181b;">${safeTitle}</h1>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#475569;">${safeIntro}</p>
                ${
                  safeCode
                    ? `<div style="margin:20px 0;padding:16px 18px;text-align:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:28px;letter-spacing:6px;font-weight:800;color:#1d4ed8;">${safeCode}</div>`
                    : ""
                }
                ${
                  safeActionUrl && safeActionLabel
                    ? `<p style="margin:22px 0;"><a href="${safeActionUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:10px;">${safeActionLabel}</a></p>
                       <p style="margin:0 0 18px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">If the button does not open, copy this link:<br>${safeActionUrl}</p>`
                    : ""
                }
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${safeWarning}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef2f7;font-size:12px;line-height:1.6;color:#64748b;">
                This email was sent automatically by FTM. Do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendAuthEmail({
  actionLabel,
  actionUrl,
  code,
  email,
  htmlIntro,
  subject,
  lines,
  devLogLabel,
  kind,
  warning,
}: {
  actionLabel?: string;
  actionUrl?: string;
  code?: string;
  email: string;
  htmlIntro: string;
  subject: string;
  lines: string[];
  devLogLabel: string;
  kind: EmailTemplateKind;
  warning: string;
}): Promise<EmailDeliveryResult> {
  const body = [
    ...lines,
    "",
    isProductionLikeEnvironment()
      ? ""
      : "This message is from a non-production environment.",
  ]
    .filter(Boolean)
    .join("\n");

  if (!hasSmtpConfig()) {
    if (canLogOtpInDevelopment()) {
      globalThis.console.info(`[${devLogLabel}] ${email}\n${body}`);
      return { delivered: true, delivery: "log" };
    }

    return {
      delivered: false,
      delivery: "none",
      reason: "SMTP is not configured.",
    };
  }

  const secure =
    process.env.SMTP_SECURE?.trim().toLowerCase() === "true" ||
    getSmtpPort() === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: getSmtpPort(),
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: body,
    html: buildHtmlEmail({
      actionLabel,
      actionUrl,
      code: kind === "otp" ? code : undefined,
      intro: htmlIntro,
      title: subject,
      warning,
    }),
  });

  return { delivered: true, delivery: "email" };
}

export async function sendAdminLoginOtp({
  email,
  code,
}: {
  email: string;
  code: string;
}): Promise<OtpDeliveryResult> {
  return sendAuthEmail({
    code,
    email,
    subject: "FTM admin sign-in code",
    htmlIntro:
      "Use the following code to complete the admin sign-in process. This code is short-lived and can only be used once.",
    lines: [
      "FTM admin sign-in code:",
      "",
      code,
      "",
      "The code is short-lived and can only be used once.",
    ],
    devLogLabel: "DEV-OTP",
    kind: "otp",
    warning:
      "If you are not signing in as admin, ignore this email and change your password immediately.",
  });
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
}: {
  email: string;
  resetUrl: string;
}): Promise<EmailDeliveryResult> {
  return sendAuthEmail({
    actionLabel: "Create new password",
    actionUrl: resetUrl,
    email,
    subject: "FTM password reset",
    htmlIntro:
      "We received a password reset request for your FTM account. Click the button below to create a new password.",
    lines: [
      "FTM password reset request received.",
      "",
      "Open the link below to create a new password:",
      resetUrl,
      "",
      "If you did not request a reset, ignore this message.",
    ],
    devLogLabel: "DEV-PASSWORD-RESET",
    kind: "action",
    warning:
      "If you did not request a password reset, ignore this email. The link will expire automatically.",
  });
}

export async function sendEmailVerificationEmail({
  email,
  verificationUrl,
}: {
  email: string;
  verificationUrl: string;
}): Promise<EmailDeliveryResult> {
  return sendAuthEmail({
    actionLabel: "Verifikasi email",
    actionUrl: verificationUrl,
    email,
    subject: "FTM email verification",
    htmlIntro:
      "Email verification is required before your FTM account can be approved by an administrator. Click the button below to continue.",
    lines: [
      "FTM account email verification is required before the account can be approved.",
      "",
      "Open the link below to verify your email:",
      verificationUrl,
      "",
      "If you do not remember creating an account, ignore this message.",
    ],
    devLogLabel: "DEV-EMAIL-VERIFY",
    kind: "action",
    warning:
      "If you do not remember creating an FTM account, ignore this email.",
  });
}
