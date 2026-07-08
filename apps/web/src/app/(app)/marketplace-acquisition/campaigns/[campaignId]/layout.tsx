import Link from "next/link";
import type { ReactNode } from "react";

interface CampaignLayoutProps {
  readonly children: ReactNode;
  readonly params: { readonly campaignId: string };
}

function CampaignTabs({ campaignId }: { readonly campaignId: string }) {
  const base = `/marketplace-acquisition/campaigns/${campaignId}`;
  const tabs = [
    { label: "Campaign Workbench", href: `${base}/workbench` },
    { label: "Discovery", href: `${base}/discovery` },
  ];

  return (
    <div className="border-b border-border px-6">
      <nav aria-label="Campaign sections" className="flex gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative px-4 py-3 text-sm font-medium text-muted-foreground transition hover:text-foreground data-[active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default function CampaignLayout({ children, params }: CampaignLayoutProps) {
  const campaignId = decodeURIComponent(params.campaignId);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <CampaignTabs campaignId={campaignId} />
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
