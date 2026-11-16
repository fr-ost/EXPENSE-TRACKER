import type { Metadata } from "next";
import { RecurringView } from "@/components/recurring/recurring-view";
import { loadPageContext } from "@/lib/server/page-context";
import { listRecurring, upcomingOccurrences } from "@/lib/server/services/recurring";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const { userId, today } = await loadPageContext();
  const rules = await listRecurring(userId);
  return <RecurringView rules={rules} upcoming={upcomingOccurrences(rules, today)} today={today} />;
}
