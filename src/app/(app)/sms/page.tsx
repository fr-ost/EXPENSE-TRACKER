import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SmsImporter } from "@/components/sms/sms-importer";
import { loadPageContext } from "@/lib/server/page-context";

export const metadata: Metadata = { title: "Import SMS" };

export default async function SmsPage() {
  await loadPageContext();
  return (
    <>
      <PageHeader
        title="Import from SMS"
        description="Paste a transaction message from your bank or mobile wallet. Hisab reads the amount, bank, type, date and time, and adds it for you."
      />
      <SmsImporter />
    </>
  );
}
