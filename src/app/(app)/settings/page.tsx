import { FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { InstallAppCard } from "@/components/pwa/install-app";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { ExchangeRates } from "@/components/settings/exchange-rates";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { SessionsList } from "@/components/settings/security-section";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/misc";
import { loadPageContext } from "@/lib/server/page-context";
import { listCategories } from "@/lib/server/services/categories";
import { getCurrencies } from "@/lib/server/services/currency";
import { listSessions } from "@/lib/server/services/settings";
import { appVersion } from "@/lib/server/version";

export const metadata: Metadata = { title: "Settings" };

function timezones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(current) ? all : [current, ...all];
}

export default async function SettingsPage() {
  const { settings, session } = await loadPageContext();
  const [categories, sessions, currencies] = await Promise.all([
    listCategories(),
    listSessions(session.id),
    getCurrencies(settings.baseCurrency),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Preferences, security and categories." />

      <Card>
        <CardHeader title="Preferences" />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <PreferencesForm settings={settings} timezones={timezones(settings.timezone)} />
        </div>
      </Card>

      <Card id="rates" className="scroll-mt-20">
        <CardHeader
          title="Exchange rates"
          description={`Other currencies count in ${settings.baseCurrency} at these rates — in your total balance, income, spending and budgets.`}
        />
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <ExchangeRates base={settings.baseCurrency} foreign={currencies.foreign} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Categories" description="Rename, recolour, set the usual classification, or archive categories you no longer use." />
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <CategoriesManager categories={categories} />
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Password" description="Kept on the server as a variable, never in the database." />
          <div className="flex flex-col gap-3 px-5 pb-6 pt-4 text-body text-text-secondary sm:px-6">
            <p>
              Your password is the <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-small text-text">ADMIN_PASSWORD</code>{" "}
              variable of the Railway service. To change it:
            </p>
            <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-text-tertiary">
              <li>In Railway, open the service → Variables.</li>
              <li>Edit ADMIN_PASSWORD and deploy the change.</li>
              <li>Every device is signed out. Sign in with the new password.</li>
            </ol>
          </div>
        </Card>
        <Card>
          <CardHeader title="Signed-in devices" />
          <div className="px-5 pb-5 pt-2 sm:px-6">
            <SessionsList sessions={sessions} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="App" description={`Version ${appVersion()}`} />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <InstallAppCard />
        </div>
      </Card>

      <Card>
        <CardHeader title="Your data" description="Download everything you have recorded. Exports are generated on demand and never stored." />
        <div className="flex flex-wrap gap-2 px-5 pb-5 pt-4 sm:px-6">
          <Button asChild variant="outline">
            <a href="/api/export/transactions?format=csv" download>
              <FileTextIcon />
              All transactions (CSV)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/export/transactions?format=xlsx" download>
              <FileSpreadsheetIcon />
              All transactions (Excel)
            </a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
