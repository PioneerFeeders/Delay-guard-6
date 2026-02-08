/**
 * Email Branding Settings Component
 *
 * Allows merchants to:
 * 1. Add a logo URL for the email header
 * 2. Configure company contact info for the email footer
 * 3. Preview how the branded email will look
 *
 * Place this component inside your Settings page (e.g., app.settings.tsx)
 * as a new tab or card section.
 *
 * Usage:
 *   <EmailBrandingSettings
 *     branding={settings.emailBranding}
 *     onSave={(branding) => saveMerchantSettings({ emailBranding: branding })}
 *     isSaving={isSaving}
 *   />
 */

import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  TextField,
  RangeSlider,
  Text,
  Button,
  Banner,
  Divider,
  Box,
  Thumbnail,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";

export interface EmailBrandingValues {
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

const DEFAULT_BRANDING: EmailBrandingValues = {
  logoUrl: null,
  logoWidth: 200,
  logoAlt: "",
  footerCompanyName: "",
  footerAddressLine1: "",
  footerAddressLine2: "",
  footerPhone: "",
  footerEmail: "",
  footerWebsite: "",
};

interface Props {
  branding?: Partial<EmailBrandingValues>;
  onSave: (branding: EmailBrandingValues) => void;
  isSaving?: boolean;
}

export function EmailBrandingSettings({ branding, onSave, isSaving }: Props) {
  const [values, setValues] = useState<EmailBrandingValues>({
    ...DEFAULT_BRANDING,
    ...branding,
  });
  const [logoError, setLogoError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleChange = useCallback(
    (field: keyof EmailBrandingValues) => (value: string | number) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      if (field === "logoUrl") setLogoError(null);
    },
    []
  );

  const handleLogoBlur = useCallback(() => {
    if (values.logoUrl && values.logoUrl.trim() !== "") {
      try {
        new URL(values.logoUrl);
        setLogoError(null);
      } catch {
        setLogoError("Please enter a valid URL (e.g., https://example.com/logo.png)");
      }
    } else {
      setLogoError(null);
    }
  }, [values.logoUrl]);

  const handleSave = useCallback(() => {
    // Clean up empty strings to null for logoUrl
    const cleaned = {
      ...values,
      logoUrl: values.logoUrl?.trim() || null,
    };
    onSave(cleaned);
  }, [values, onSave]);

  const hasChanges =
    JSON.stringify({ ...DEFAULT_BRANDING, ...branding }) !== JSON.stringify(values);

  return (
    <BlockStack gap="400">
      {/* Logo Header Section */}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Email Logo
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Add your company logo to the top of notification emails. Use a URL to
            a hosted image (PNG or JPG, recommended width 200–400px).
          </Text>

          <TextField
            label="Logo URL"
            value={values.logoUrl || ""}
            onChange={(v) => handleChange("logoUrl")(v)}
            onBlur={handleLogoBlur}
            placeholder="https://example.com/logo.png"
            error={logoError || undefined}
            autoComplete="off"
            helpText="Paste the URL of your logo image. Host it on your Shopify store, CDN, or any public URL."
          />

          {values.logoUrl && !logoError && (
            <InlineStack gap="400" blockAlign="center">
              <Thumbnail
                source={values.logoUrl}
                alt={values.logoAlt || "Logo preview"}
                size="large"
              />
              <Text as="span" variant="bodySm" tone="subdued">
                Logo preview
              </Text>
            </InlineStack>
          )}

          <RangeSlider
            label="Logo width (pixels)"
            value={values.logoWidth}
            onChange={(v) => handleChange("logoWidth")(v as number)}
            min={50}
            max={400}
            step={10}
            output
            helpText={`${values.logoWidth}px — adjusts the display width in the email header`}
          />

          <TextField
            label="Logo alt text"
            value={values.logoAlt}
            onChange={(v) => handleChange("logoAlt")(v)}
            placeholder="Your Company Name"
            autoComplete="off"
            helpText="Displayed when the image can't load. Good for accessibility."
          />
        </BlockStack>
      </Card>

      {/* Footer Contact Info Section */}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Email Footer — Contact Info
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Add your company contact details to the bottom of notification
            emails. Only filled fields will appear.
          </Text>

          <TextField
            label="Company name"
            value={values.footerCompanyName}
            onChange={(v) => handleChange("footerCompanyName")(v)}
            placeholder="Pioneer Feeders LLC"
            autoComplete="off"
          />

          <TextField
            label="Address line 1"
            value={values.footerAddressLine1}
            onChange={(v) => handleChange("footerAddressLine1")(v)}
            placeholder="123 Main Street"
            autoComplete="off"
          />

          <TextField
            label="Address line 2"
            value={values.footerAddressLine2}
            onChange={(v) => handleChange("footerAddressLine2")(v)}
            placeholder="Iron Mountain, MI 49801"
            autoComplete="off"
          />

          <InlineStack gap="400">
            <Box minWidth="0" width="50%">
              <TextField
                label="Phone"
                value={values.footerPhone}
                onChange={(v) => handleChange("footerPhone")(v)}
                placeholder="(906) 555-1234"
                autoComplete="off"
              />
            </Box>
            <Box minWidth="0" width="50%">
              <TextField
                label="Email"
                value={values.footerEmail}
                onChange={(v) => handleChange("footerEmail")(v)}
                placeholder="support@yourstore.com"
                autoComplete="off"
                type="email"
              />
            </Box>
          </InlineStack>

          <TextField
            label="Website"
            value={values.footerWebsite}
            onChange={(v) => handleChange("footerWebsite")(v)}
            placeholder="www.yourstore.com"
            autoComplete="off"
          />
        </BlockStack>
      </Card>

      {/* Save */}
      <InlineStack align="end">
        <Button
          variant="primary"
          onClick={handleSave}
          loading={isSaving}
          disabled={!hasChanges && !isSaving}
        >
          Save Email Branding
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
