import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/domain";

/**
 * Makes Hisab installable (Chrome/Edge "Install app", Android "Add to home
 * screen"). Served at /manifest.webmanifest, which is public: it describes
 * the app and holds no data.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${APP_NAME} — personal finance`,
    short_name: APP_NAME,
    description: "Your private ledger: accounts, spending, budgets and reports.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "New transaction",
        short_name: "New",
        url: "/transactions?new=1",
        icons: [{ src: "/icons/shortcut-add.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Import SMS",
        short_name: "SMS",
        url: "/sms",
        icons: [{ src: "/icons/shortcut-sms.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Reports",
        url: "/reports",
        icons: [{ src: "/icons/shortcut-reports.png", sizes: "96x96", type: "image/png" }],
      },
    ],
    // Share a bank SMS to Hisab from the phone's share sheet (Android).
    share_target: {
      action: "/sms/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text" },
    },
  };
}
