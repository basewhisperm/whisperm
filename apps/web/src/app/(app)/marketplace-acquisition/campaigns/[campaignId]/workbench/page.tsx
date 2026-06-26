import { AcquisitionWorkbench } from "@/components/marketplace-acquisition/acquisition-workbench";

interface CampaignWorkbenchPageProps {
  readonly params: {
    readonly campaignId: string;
  };
}

export default function CampaignWorkbenchPage({ params }: CampaignWorkbenchPageProps) {
  const recordsPath = `/api/marketplace-acquisition/records?campaignId=${encodeURIComponent(params.campaignId)}`;

  return (
    <AcquisitionWorkbench
      mode="campaign"
      recordsPath={recordsPath}
      title="Campaign Workbench"
      description="Run this campaign from one focused workspace: qualify assigned sellers, repair extracted data, send WhatsApp-first invitations, retry failures, and move sellers through claim and conversion."
      contextNote="This campaign-scoped workbench preserves the global acquisition workflow while narrowing the queue to sellers assigned to this campaign."
    />
  );
}
