import type { NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth/guard";

/**
 * Web Share Target for the installed app: sharing an SMS to Hisab POSTs it
 * here. The text is handed to the import page in the URL fragment, which
 * browsers never send to a server, so messages don't end up in access logs.
 */
export async function POST(request: NextRequest) {
  const redirect = (location: string) =>
    new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

  // Shares come from the device's share sheet ("none"); refuse posts from other sites.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "none" && site !== "same-origin") return redirect("/sms");

  const session = await getSession();
  if (!session) return redirect("/login?next=%2Fsms");

  const form = await request.formData().catch(() => null);
  const parts = ["title", "text"]
    .map((field) => form?.get(field))
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const shared = [...new Set(parts)].join("\n").slice(0, 20_000);
  return redirect(shared ? `/sms#shared=${encodeURIComponent(shared)}` : "/sms");
}
