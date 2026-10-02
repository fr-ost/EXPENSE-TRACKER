import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { MotionProvider } from "@/components/motion-provider";
import { INSTALL_CAPTURE } from "@/components/pwa/install-capture";
import { PwaSetup } from "@/components/pwa/pwa-setup";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME } from "@/lib/domain";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Private personal finance ledger.",
  robots: { index: false, follow: false, nocache: true },
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android Chrome: the keyboard shrinks the page instead of covering it, so
  // a bottom sheet and its focused field stay in view above it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full bg-canvas">
        <Script id="install-capture" strategy="beforeInteractive">
          {INSTALL_CAPTURE}
        </Script>
        <PwaSetup />
        <MotionProvider>
          <TooltipProvider delayDuration={300} skipDelayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
