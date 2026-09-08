import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Noto_Sans_SC } from "next/font/google";

import { PRODUCT } from "@/core/config/product";

import { AppShell } from "./app-shell";
import { THEME_BOOTSTRAP_SCRIPT } from "./theme";
import "./globals.css";

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-sc",
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT.name,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={notoSansSc.variable}
      data-theme="light"
      lang="zh-CN"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
