import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "RP World Builder",
  description:
    "Roleplay with an AI narrator. The canon and the campaign stay on your computer: no account, no advertising, no telemetry.",
};

export const viewport: Viewport = {
  themeColor: "#0d1030",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The root layout does the minimum: `<html>` and `<body>`, which in Next exist only
 * here, plus the stylesheets and the language provider.
 *
 * The chrome — sidebar, watermark, backdrop — lives in the route-group frames,
 * because it isn't the same everywhere: inside a world the sidebar must be
 * gone, and deciding that here would mean a URL-dependent condition inside every
 * page. Two frames saying what they are beats one.
 *
 * `<html lang>` starts as the fallback language and the provider corrects it once
 * the saved setting arrives: the server has no way to know it, and `lang` that
 * disagrees with the text is worse than `lang` that is briefly approximate.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
