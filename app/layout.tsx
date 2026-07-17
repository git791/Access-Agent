import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AccessAgent — verified accessibility fixes",
  description: "Audit, patch, and verify accessibility fixes against a rendered experience."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
