import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SmsImporter } from "@/components/sms/sms-importer";
import { loadPageContext } from "@/lib/server/page-context";
import { listWaitingSms } from "@/lib/server/services/sms-inbox";

export const metadata: Metadata = { title: "Import SMS" };

export default async function SmsPage() {
  const { userId } = await loadPageContext();
  // Messages a linked phone handed in that couldn't be added on their own.
  const { messages, total } = await listWaitingSms(userId);
  return (
    <>
      <PageHeader
        title="Import from SMS"
        description="Paste a transaction message from your bank or mobile wallet. Hisab reads the amount, bank, type, date and time, and adds it for you."
      />
      <SmsImporter waiting={messages.map(({ id, text, receivedAt }) => ({ id, text, receivedAt }))} waitingTotal={total} />
    </>
  );
}
