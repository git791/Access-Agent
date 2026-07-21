import type { Metadata } from "next";
import "./styles.css";

const logoIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23183A5A'/%3E%3Ctext x='32' y='40' text-anchor='middle' fill='%23fff1dd' font-family='Arial,sans-serif' font-size='20' font-weight='700'%3EPR%3C/text%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "PRGate — Accessibility audit workspace",
  description: "Audit public previews, prioritize accessibility barriers, and retain the evidence behind every verified result.",
  applicationName: "PRGate",
  icons: { icon: logoIcon },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
