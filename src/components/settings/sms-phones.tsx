"use client";

import { SmartphoneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { androidLinkIntent } from "@/lib/android";
import { api, errorMessage } from "@/lib/api-client";
import { useFormatMoment } from "./restore-dialog";

/** A phone that hands its bank and wallet SMS to this account (services/devices.ts). */
export interface LinkedPhone {
  id: string;
  name: string;
  linkedAt: string;
  lastSeenAt: string | null;
}

/** What happened when the person came back from the Android app (?phone=…). */
const NOTICES: Record<string, { text: string; good?: boolean }> = {
  linked: { text: "This phone is linked. New bank and wallet messages are added as they arrive.", good: true },
  missing: { text: "The Hisab app isn't on this phone yet. Install it, open it, and come back to this page inside it." },
};

const noChange = () => () => undefined;

/**
 * Automatic SMS import: the Android app on a linked phone hands in bank and
 * wallet messages as they arrive. Linking starts here, in the app's own
 * browser, where the person is signed in.
 */
export function SmsPhones({ phones, notice }: { phones: LinkedPhone[]; notice?: string }) {
  const router = useRouter();
  const formatMoment = useFormatMoment();
  const [linking, setLinking] = React.useState(false);
  const [removing, setRemoving] = React.useState<LinkedPhone | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Only an Android phone can be linked; the server can't tell what this is.
  const onAndroid = React.useSyncExternalStore(
    noChange,
    () => /Android/i.test(navigator.userAgent),
    () => false,
  );
  const said = notice ? NOTICES[notice] : undefined;

  async function link() {
    setLinking(true);
    try {
      const { code } = await api<{ code: string }>("/api/devices/link");
      // Handing over to the app is a navigation: the page stays as it is underneath.
      window.location.href = androidLinkIntent(code, `${window.location.origin}/settings?phone=missing#sms-phones`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      // The app takes over the screen; if it didn't, the button works again.
      window.setTimeout(() => setLinking(false), 1500);
    }
  }

  async function remove(phone: LinkedPhone) {
    setBusy(true);
    try {
      await api(`/api/devices/${phone.id}`, { method: "DELETE" });
      toast.success(`${phone.name} removed`);
      setRemoving(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-text-secondary">
        With the Hisab app on your Android phone, messages from your bank and mobile wallet are read as they arrive. A message that is
        clear is added on its own; one that isn&apos;t waits for you on Import SMS. Only messages about money from banks and wallets
        leave the phone — verification codes and personal messages never do.
      </p>

      {said && (
        <p role="status" className={said.good ? "rounded-lg bg-positive-soft px-3 py-2 text-small text-positive-text" : "rounded-lg bg-warning-soft px-3 py-2 text-small text-warning-text"}>
          {said.text}
        </p>
      )}

      {phones.length > 0 && (
        <ul aria-label="Linked phones" className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {phones.map((phone) => (
            <li key={phone.id} className="flex items-center gap-3 px-4 py-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
                <SmartphoneIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-text">{phone.name}</p>
                <p className="text-small text-text-tertiary">
                  Linked {formatMoment(phone.linkedAt)}
                  {phone.lastSeenAt ? ` · last message ${formatMoment(phone.lastSeenAt)}` : " · no messages yet"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRemoving(phone)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {onAndroid ? (
          <Button variant={phones.length ? "outline" : "primary"} loading={linking} onClick={() => void link()}>
            <SmartphoneIcon />
            {phones.length ? "Set up on this phone too" : "Set up on this phone"}
          </Button>
        ) : (
          <p className="text-small text-text-tertiary">To set it up, open this page in the Hisab app on your Android phone.</p>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : "Remove this phone?"}
        description="It stops sending messages to Hisab straight away. Everything already added stays. You can link it again from the app."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}
