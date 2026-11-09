import type { Metadata, Viewport } from "next";

import { AppHeader } from "@/components/layout/AppHeader";

import "./globals.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: { default: "Probing QC", template: "%s · Probing QC" },
  description: "Quality control and annotation tooling for GoPro probing videos.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppHeader />
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
