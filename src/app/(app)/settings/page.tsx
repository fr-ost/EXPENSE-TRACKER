import { FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PageHeader } from "@/components/layout/page-header";
import { InstallAppCard } from "@/components/pwa/install-app";
import { AppLock } from "@/components/settings/app-lock";
import { BackupFiles } from "@/components/settings/backup-restore";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { DeleteAccount } from "@/components/settings/delete-account";
import { DriveBackups } from "@/components/settings/drive-backups";
import { ExchangeRates } from "@/components/settings/exchange-rates";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { SessionsList } from "@/components/settings/security-section";
import { SmsPhones } from "@/components/settings/sms-phones";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/misc";
import { loadPageContext } from "@/lib/server/page-context";
import { listCategories } from "@/lib/server/services/categories";
import { getCurrencies } from "@/lib/server/services/currency";
import { listDevices } from "@/lib/server/services/devices";
import { getDriveStatus } from "@/lib/server/services/drive";
import { listSessions } from "@/lib/server/services/settings";
import { getAccountEmail } from "@/lib/server/settings";
import { appVersion } from "@/lib/server/version";

export const metadata: Metadata = { title: "Settings" };

function timezones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(current) ? all : [current, ...all];
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { userId, settings, session } = await loadPageContext();
  const [categories, sessions, currencies, email, drive, phones, params] = await Promise.all([
    listCategories(userId),
    listSessions(userId, session.id),
    getCurrencies(userId, settings.baseCurrency),
    getAccountEmail(userId),
    getDriveStatus(userId),
    listDevices(userId),
    searchParams,
  ]);
  const driveNotice = typeof params.drive === "string" ? params.drive : undefined;
  const phoneNotice = typeof params.phone === "string" ? params.phone : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Preferences, security, categories and your account." />

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
          <CardHeader title="Account" description="You sign in with Google. Hisab never sees your Google password." />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-4 sm:px-6">
            <p className="min-w-0 text-body text-text-secondary">
              Signed in as <span className="break-all font-medium text-text">{email ?? "your Google account"}</span>
            </p>
            <SignOutButton variant="outline" size="sm" withIcon />
          </div>
        </Card>
        <Card>
          <CardHeader title="Signed-in devices" />
          <div className="px-5 pb-5 pt-2 sm:px-6">
            <SessionsList sessions={sessions} />
          </div>
        </Card>
      </div>

      <Card id="app-lock" className="scroll-mt-20">
        <CardHeader title="App lock" description="A PIN for this app, on top of signing in." />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <AppLock hasPin={session.hasPin} autoLockMinutes={settings.autoLockMinutes} />
        </div>
      </Card>

      <Card id="sms-phones" className="scroll-mt-20">
        <CardHeader title="Automatic SMS import" description="Bank and wallet messages, added as they arrive on your phone." />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <SmsPhones phones={phones.map(({ id, name, linkedAt, lastSeenAt }) => ({ id, name, linkedAt, lastSeenAt }))} notice={phoneNotice} />
        </div>
      </Card>

      <Card>
        <CardHeader title="App" description={`Version ${appVersion()}`} />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <InstallAppCard />
        </div>
      </Card>

      <Card id="backup" className="scroll-mt-20">
        <CardHeader
          title="Backup and restore"
          description="A backup file holds everything you have recorded — accounts, transactions, balances, budgets, categories and preferences."
        />
        <div className="flex flex-col gap-5 px-5 pb-5 pt-4 sm:px-6">
          <BackupFiles />
          <DriveBackups status={drive} notice={driveNotice} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Export" description="Your transactions as a spreadsheet. Exports are generated on demand and never stored." />
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

      <Card id="delete-account" className="scroll-mt-20">
        <CardHeader title="Delete account" description="Remove your account and everything recorded in it." />
        <div className="px-5 pb-6 pt-4 sm:px-6">
          <DeleteAccount />
        </div>
      </Card>
    </div>
  );
}
