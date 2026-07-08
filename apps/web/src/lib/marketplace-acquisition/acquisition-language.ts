// ST1-013G — canonical acquisition UX vocabulary. Every acquisition screen should be able to
// answer "where am I in the Golden Path, what object am I acting on, what happens if I click
// this" from its label alone. Prefer these constants over inventing new copy inline; if a screen
// needs wording that isn't here yet, add it here first rather than hardcoding a one-off string.
export const ACQUISITION_COPY = {
  pages: {
    workbench: "Acquisition Workbench",
    campaigns: "Campaigns",
    campaignWorkbench: "Campaign Workbench",
    sellerDetail: "Seller Detail",
    sellerDiscovery: "Discovery",
  },
  actions: {
    createCampaign: "Create Campaign",
    captureSeller: "Capture Seller",
    configureTargeting: "Configure Targeting",
    saveTargeting: "Save Targeting",
    runDiscovery: "Run Discovery",
    reviewSeller: "Review Seller",
    reviewSellers: "Review Sellers",
    openSeller: "Open Seller",
    openWorkbench: "Open Workbench",
    queueInvitation: "Queue Invitation",
    sendInvitation: "Send Invitation",
    monitorClaim: "Monitor Claim",
    convertSeller: "Convert Seller",
    convertInventory: "Convert Inventory",
    openCrmContact: "Open CRM Contact",
  },
  states: {
    needsReview: "Needs Review",
    phoneReady: "Phone Ready",
    invitationReady: "Invitation Ready",
    waitingClaim: "Waiting Claim",
    claimed: "Claimed",
    readyToConvert: "Ready to Convert",
    converted: "Converted",
    blocked: "Blocked",
  },
} as const;
