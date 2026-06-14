export const ACQUISITION_STAGE_NAMES = Object.freeze({
  captured: "Captured",
  invited: "Invited",
  claimStarted: "Claim Started",
  claimed: "Claimed",
  converted: "Converted",
  expired: "Expired",
});

const normalizeStageName = (name) => name.trim().toLowerCase();

const countDealsForStage = (deals, stageId) => deals.filter((deal) => deal.pipelineStageId === stageId).length;

export function computeAcquisitionSummary(pipeline, deals) {
  const countsByName = new Map(
    (pipeline?.stages ?? []).map((stage) => [normalizeStageName(stage.name), countDealsForStage(deals, stage.id)]),
  );

  const captured = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.captured)) ?? 0;
  const invited = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.invited)) ?? 0;
  const claimStarted = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.claimStarted)) ?? 0;
  const claimed = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.claimed)) ?? 0;
  const converted = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.converted)) ?? 0;
  const expired = countsByName.get(normalizeStageName(ACQUISITION_STAGE_NAMES.expired)) ?? 0;

  return {
    captured,
    invited,
    claimStarted,
    claimed,
    converted,
    expired,
    conversionRate: captured === 0 ? 0 : converted / captured,
    recentCount: deals.length,
  };
}

export function formatAcquisitionConversionRate(rate) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(rate);
}
