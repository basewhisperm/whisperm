interface DiscoveryPageProps {
  readonly params: { readonly campaignId: string };
}

export default function DiscoveryPage({ params }: DiscoveryPageProps) {
  const campaignId = decodeURIComponent(params.campaignId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Seller Discovery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automatically find and qualify marketplace sellers to feed into this campaign.
        </p>
      </div>

      <div
        className="rounded-2xl bg-background p-8 text-center"
        style={{ border: "0.5px solid var(--color-border)" }}
      >
        <p className="text-sm font-medium text-foreground">Discovery engine coming soon</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Campaign ID: {campaignId}
        </p>
      </div>
    </div>
  );
}
