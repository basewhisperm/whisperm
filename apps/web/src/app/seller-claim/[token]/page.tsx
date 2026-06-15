import { OWNERSHIP_ATTESTATION_STATEMENT } from "@whisperm/types";

interface PageProps { readonly params: { readonly token: string } }

export default function SellerClaimPage({ params }: PageProps) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif" }}>
      <h1>Claim seller profile</h1>
      <p>Please attest that you are authorized to claim this seller profile and captured inventory.</p>
      <form method="post" action={`/api/seller-claim/${encodeURIComponent(params.token)}/accept`}>
        <label>
          Claimant name *
          <input name="claimantName" required minLength={1} style={{ display: "block", width: "100%", marginBottom: 16 }} />
        </label>
        <label>
          Claimant phone
          <input name="claimantPhone" type="tel" style={{ display: "block", width: "100%", marginBottom: 16 }} />
        </label>
        <label>
          Claimant email
          <input name="claimantEmail" type="email" style={{ display: "block", width: "100%", marginBottom: 16 }} />
        </label>
        <label>
          Marketplace identity
          <input name="marketplaceIdentity" style={{ display: "block", width: "100%", marginBottom: 16 }} />
        </label>
        <fieldset style={{ marginBottom: 16 }}>
          <legend>Ownership attestation</legend>
          <p>{OWNERSHIP_ATTESTATION_STATEMENT}</p>
          <label><input name="acceptedTerms" type="checkbox" value="true" required /> I agree</label>
        </fieldset>
        <button type="submit">Accept claim</button>
      </form>
    </main>
  );
}
