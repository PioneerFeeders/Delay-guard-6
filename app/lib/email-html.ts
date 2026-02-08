/**
 * Email HTML Renderer
 *
 * Builds a branded HTML email from a plain-text template body,
 * adding an optional logo header and contact info footer.
 *
 * Uses inline styles and table-based layout for maximum email client compatibility.
 */

import type { MerchantSettings } from "~/lib/validation";

export interface EmailBranding {
  logoUrl: string | null;
  logoWidth: number;
  logoAlt: string;
  footerCompanyName: string;
  footerAddressLine1: string;
  footerAddressLine2: string;
  footerPhone: string;
  footerEmail: string;
  footerWebsite: string;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert plain text body to HTML paragraphs,
 * auto-linking URLs for clickability
 */
function textToHtml(text: string): string {
  const escaped = escapeHtml(text);

  // Auto-link URLs
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color: #2563eb; text-decoration: underline;">$1</a>'
  );

  // Convert double newlines to paragraph breaks, single newlines to <br>
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin: 0 0 16px 0; line-height: 1.6;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return paragraphs;
}

/**
 * Build the logo header HTML block
 */
function buildLogoHeader(branding: EmailBranding): string {
  if (!branding.logoUrl) return "";

  const alt = escapeHtml(branding.logoAlt || "Company Logo");

  return `
    <tr>
      <td style="padding: 24px 32px 16px 32px; text-align: center; border-bottom: 1px solid #e5e7eb;">
        <img
          src="${escapeHtml(branding.logoUrl)}"
          alt="${alt}"
          width="${branding.logoWidth}"
          style="max-width: 100%; height: auto; display: inline-block;"
        />
      </td>
    </tr>`;
}

/**
 * Build the footer contact info HTML block
 */
function buildFooter(branding: EmailBranding): string {
  const lines: string[] = [];

  if (branding.footerCompanyName) {
    lines.push(`<strong>${escapeHtml(branding.footerCompanyName)}</strong>`);
  }
  if (branding.footerAddressLine1) {
    lines.push(escapeHtml(branding.footerAddressLine1));
  }
  if (branding.footerAddressLine2) {
    lines.push(escapeHtml(branding.footerAddressLine2));
  }

  const contactParts: string[] = [];
  if (branding.footerPhone) {
    contactParts.push(`Phone: ${escapeHtml(branding.footerPhone)}`);
  }
  if (branding.footerEmail) {
    contactParts.push(
      `Email: <a href="mailto:${escapeHtml(branding.footerEmail)}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(branding.footerEmail)}</a>`
    );
  }
  if (contactParts.length > 0) {
    lines.push(contactParts.join(" &nbsp;|&nbsp; "));
  }

  if (branding.footerWebsite) {
    const url = branding.footerWebsite.startsWith("http")
      ? branding.footerWebsite
      : `https://${branding.footerWebsite}`;
    lines.push(
      `<a href="${escapeHtml(url)}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(branding.footerWebsite)}</a>`
    );
  }

  // If no footer info at all, return empty
  if (lines.length === 0) return "";

  return `
    <tr>
      <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb; background-color: #f9fafb;">
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #6b7280;">
          ${lines.join("<br>")}
        </p>
      </td>
    </tr>`;
}

/**
 * Render a branded HTML email from plain-text body content
 *
 * @param body - The rendered plain-text email body
 * @param branding - Email branding settings (logo + footer)
 * @returns Full HTML email string
 */
export function renderHtmlEmail(body: string, branding: EmailBranding): string {
  const logoHeader = buildLogoHeader(branding);
  const footer = buildFooter(branding);
  const bodyHtml = textToHtml(body);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Shipment Update</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <!-- Outer wrapper for background color -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Inner content card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          ${logoHeader}
          <!-- Email body -->
          <tr>
            <td style="padding: 32px; font-size: 15px; color: #1f2937;">
              ${bodyHtml}
            </td>
          </tr>
          ${footer}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Extract branding config from MerchantSettings
 */
export function extractBranding(settings: MerchantSettings): EmailBranding {
  const b = settings.emailBranding;
  return {
    logoUrl: b?.logoUrl ?? null,
    logoWidth: b?.logoWidth ?? 200,
    logoAlt: b?.logoAlt ?? "",
    footerCompanyName: b?.footerCompanyName ?? "",
    footerAddressLine1: b?.footerAddressLine1 ?? "",
    footerAddressLine2: b?.footerAddressLine2 ?? "",
    footerPhone: b?.footerPhone ?? "",
    footerEmail: b?.footerEmail ?? "",
    footerWebsite: b?.footerWebsite ?? "",
  };
}

/**
 * Check if branding has any content (logo or footer)
 * If not, we can skip the HTML wrapper and send plain text
 */
export function hasBranding(settings: MerchantSettings): boolean {
  const b = settings.emailBranding;
  if (!b) return false;
  return !!(
    b.logoUrl ||
    b.footerCompanyName ||
    b.footerAddressLine1 ||
    b.footerAddressLine2 ||
    b.footerPhone ||
    b.footerEmail ||
    b.footerWebsite
  );
}
