import { AcquisitionWorkbench } from "@/components/marketplace-acquisition/acquisition-workbench";

interface CampaignWorkbenchPageProps {
  readonly params: {
    readonly campaignId: string;
  };
}

export default function CampaignWorkbenchPage({ params }: CampaignWorkbenchPageProps) {
  const campaignId = decodeURIComponent(params.campaignId);

  return (
    <AcquisitionWorkbench
      mode="campaign"
      campaignId={campaignId}
      recordsPath={`/api/marketplace-acquisition/campaigns/${encodeURIComponent(campaignId)}/records`}
      title="Campaign Workbench"
      description="Run seller acquisition operations for this campaign: review assigned sellers, fix extracted data, approve readiness, send WhatsApp-first invitations, retry failures, and move qualified sellers toward claim and conversion."
      contextNote="This campaign workbench only shows sellers assigned to this campaign. Use the global Acquisition Workbench for unassigned or cross-campaign seller operations."
    />
  );
}
