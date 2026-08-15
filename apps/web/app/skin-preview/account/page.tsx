import { notFound } from "next/navigation";
import { OttoAccount } from "@/components/otto/OttoAccount";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { AccountInfo } from "@/lib/account-actions";
import type { CreditPackShelf } from "@/lib/billing-actions";
import type { AccountViewData } from "@/lib/account-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account preview (dev)" };

export default function AccountPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const account: AccountInfo = {
    email: "owner@bloomcoffee.my", displayName: "", organizationName: "Bloom Coffee", isFounder: false, balance: 842, reserved: 12, balanceUsd: 84.2,
    recent: [
      { id: "a1", label: "Credits added", delta: 1000, at: new Date(0).toISOString(), atLabel: "Jan 1, 12:00 AM" },
      { id: "a2", label: "Video", delta: -8, at: new Date(0).toISOString(), atLabel: "Jan 1, 12:00 AM" },
      { id: "a3", label: "Chat", delta: -1.4, at: new Date(0).toISOString(), atLabel: "Jan 1, 12:00 AM", detail: "1.4 credits used · 0.6 refunded" },
    ],
  };
  const shelf: CreditPackShelf = {
    packs: [
      { priceId: "price_mock_1", credits: 500, amountCents: 4900, currency: "myr", label: "Starter" },
      { priceId: "price_mock_2", credits: 1200, amountCents: 9900, currency: "myr", label: "Growth" },
    ],
  };
  const channels = [
    { id: "instagram", label: "Instagram", status: "connected" as const, targets: ["@bloomcoffee"], connectUrl: "#" },
    { id: "facebook", label: "Facebook", status: "not_connected" as const, targets: [], connectUrl: "#" },
  ];
  return (
    <div className="fk gb-skin" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoAccount account={account} previewData={{ settings: DEFAULT_SETTINGS, channels, shelf, adsAutonomy: "ASK", canPublish: false, meta: { connected: false } } satisfies AccountViewData} />
      </div>
    </div>
  );
}
