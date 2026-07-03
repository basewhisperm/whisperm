import { AcquisitionCommandCenter } from "@/components/marketplace-acquisition/acquisition-command-center";
import { AcquisitionWorkbench } from "@/components/marketplace-acquisition/acquisition-workbench";

export default function MarketplaceAcquisitionPage() {
  return (
    <div className="space-y-6">
      <AcquisitionCommandCenter />
      <AcquisitionWorkbench
        mode="global"
        recordsPath="/api/marketplace-acquisition/records"
        title="Acquisition Workbench"
        description="Run the daily seller acquisition workflow from one place: review captured sellers, fix extracted data, approve readiness, send WhatsApp-first invitations, retry failures, and move qualified sellers toward claim and conversion."
        contextNote="This is the global workbench until sellers are assigned into campaign objects. Captured sellers stay here until they are assigned, invited, claimed, converted, or manually resolved."
      />
    </div>
  );
}
