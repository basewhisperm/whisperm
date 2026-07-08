import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAcquisitionWorkflowStage,
  getNextWorkflowAction,
  getWorkflowBlockers,
  resolveCampaignWorkflowStage,
  getNextCampaignWorkflowAction,
  getCampaignWorkflowBlockers,
} from '@whisperm/services';

const baseSignals = {
  hasDraftInventory: false,
  hasPhone: false,
  hasOwnershipAttestation: false,
  hasSellerConversion: false,
  hasInventoryConversion: false,
};

test('discovered seller with no capture yet resolves to DISCOVERY', () => {
  assert.equal(resolveAcquisitionWorkflowStage({ ...baseSignals, discovered: true }), 'DISCOVERY');
});

test('captured seller with no draft inventory resolves to CAPTURED', () => {
  assert.equal(resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CAPTURED' }), 'CAPTURED');
});

test('captured seller missing a phone number resolves to REVIEW', () => {
  const stage = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true });
  assert.equal(stage, 'REVIEW');
});

test('phone present with no invitation yet resolves to PHONE_READY', () => {
  const stage = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true, hasPhone: true });
  assert.equal(stage, 'PHONE_READY');
});

test('pending or failed invitation resolves to INVITATION_READY', () => {
  const pending = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'PENDING' });
  const failed = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'FAILED' });
  assert.equal(pending, 'INVITATION_READY');
  assert.equal(failed, 'INVITATION_READY');
});

test('sent invitation resolves to INVITATION_SENT', () => {
  const stage = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'INVITED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'SENT' });
  assert.equal(stage, 'INVITATION_SENT');
});

test('opened invitation or claim started resolves to WAITING_CLAIM', () => {
  const opened = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'INVITED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'OPENED' });
  const started = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CLAIM_STARTED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'SENT' });
  assert.equal(opened, 'WAITING_CLAIM');
  assert.equal(started, 'WAITING_CLAIM');
});

test('completed claim without a seller conversion resolves to CLAIMED', () => {
  const stage = resolveAcquisitionWorkflowStage({
    ...baseSignals, captureStatus: 'CLAIMED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true,
  });
  assert.equal(stage, 'CLAIMED');
});

test('seller conversion without inventory conversion resolves to READY_CONVERSION', () => {
  const stage = resolveAcquisitionWorkflowStage({
    ...baseSignals, captureStatus: 'CLAIMED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true, hasSellerConversion: true,
  });
  assert.equal(stage, 'READY_CONVERSION');
});

test('seller and inventory conversion resolve to CONVERTED', () => {
  const stage = resolveAcquisitionWorkflowStage({
    ...baseSignals, captureStatus: 'CONVERTED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true, hasSellerConversion: true, hasInventoryConversion: true,
  });
  assert.equal(stage, 'CONVERTED');
});

test('capture status floor prevents regression when sub-signals lag behind', () => {
  // Capture status already recorded CLAIMED, but the invitation sub-signal is missing/stale.
  const stage = resolveAcquisitionWorkflowStage({ ...baseSignals, captureStatus: 'CLAIMED', hasDraftInventory: true, hasPhone: true });
  assert.equal(stage, 'CLAIMED');
});

test('capture status floor never lowers a stage that has already progressed further', () => {
  const stage = resolveAcquisitionWorkflowStage({
    ...baseSignals, captureStatus: 'INVITED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true, hasSellerConversion: true, hasInventoryConversion: true,
  });
  assert.equal(stage, 'CONVERTED');
});

test('getNextWorkflowAction returns exactly one canonical action per stage', () => {
  assert.deepEqual(getNextWorkflowAction('DISCOVERY'), { label: 'Run Discovery', action: 'RUN_DISCOVERY', priority: 'NORMAL' });
  assert.deepEqual(getNextWorkflowAction('CAPTURED'), { label: 'Review Seller', action: 'REVIEW_SELLER', priority: 'NORMAL' });
  assert.deepEqual(getNextWorkflowAction('REVIEW'), { label: 'Verify Contact', action: 'VERIFY_CONTACT', priority: 'HIGH' });
  assert.deepEqual(getNextWorkflowAction('PHONE_READY'), { label: 'Queue Invitation', action: 'QUEUE_INVITATION', priority: 'NORMAL' });
  assert.deepEqual(getNextWorkflowAction('INVITATION_READY'), { label: 'Send Invitation', action: 'SEND_INVITATION', priority: 'HIGH' });
  assert.deepEqual(getNextWorkflowAction('WAITING_CLAIM'), { label: 'Monitor Claim', action: 'MONITOR_CLAIM', priority: 'NORMAL' });
  assert.deepEqual(getNextWorkflowAction('CLAIMED'), { label: 'Convert Seller', action: 'CONVERT_SELLER', priority: 'HIGH' });
  assert.deepEqual(getNextWorkflowAction('CONVERTED'), { label: 'Open CRM Contact', action: 'OPEN_CRM_CONTACT', priority: 'LOW' });
});

test('getWorkflowBlockers explains a missing phone number', () => {
  const blockers = getWorkflowBlockers({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true });
  assert.deepEqual(blockers, [{ reason: 'Missing phone number', severity: 'warning' }]);
});

test('getWorkflowBlockers explains a failed invitation', () => {
  const blockers = getWorkflowBlockers({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'FAILED' });
  assert.deepEqual(blockers, [{ reason: 'Invitation delivery failed and needs a retry', severity: 'blocking' }]);
});

test('getWorkflowBlockers explains an already-pending invitation', () => {
  const blockers = getWorkflowBlockers({ ...baseSignals, captureStatus: 'CAPTURED', hasDraftInventory: true, hasPhone: true, invitationStatus: 'PENDING' });
  assert.deepEqual(blockers, [{ reason: 'Invitation already pending', severity: 'info' }]);
});

test('getWorkflowBlockers is empty once every gate is satisfied and the seller is fully converted', () => {
  const blockers = getWorkflowBlockers({
    ...baseSignals, captureStatus: 'CONVERTED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true, hasSellerConversion: true, hasInventoryConversion: true,
  });
  assert.deepEqual(blockers, []);
});

test('getWorkflowBlockers flags an impossible inventory-conversion-without-seller-conversion state', () => {
  const blockers = getWorkflowBlockers({
    ...baseSignals, captureStatus: 'CLAIMED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasOwnershipAttestation: true, hasInventoryConversion: true,
  });
  assert.ok(blockers.some((blocker) => blocker.reason.includes('without a seller conversion')));
});

test('getWorkflowBlockers flags an impossible seller-conversion-without-claim state', () => {
  const blockers = getWorkflowBlockers({
    ...baseSignals, captureStatus: 'CLAIM_STARTED', hasDraftInventory: true, hasPhone: true,
    invitationStatus: 'OPENED', hasSellerConversion: true,
  });
  assert.ok(blockers.some((blocker) => blocker.reason.includes('without a completed claim')));
});

test('campaign workflow: missing targeting resolves to CONFIGURE_TARGETING with a blocker', () => {
  const stage = resolveCampaignWorkflowStage({ targetingReady: false, memberCount: 0 });
  assert.equal(stage, 'CONFIGURE_TARGETING');
  assert.deepEqual(getCampaignWorkflowBlockers({ targetingReady: false, memberCount: 0 }), [
    { reason: 'Campaign targeting incomplete', severity: 'blocking' },
  ]);
  assert.deepEqual(getNextCampaignWorkflowAction(stage), { label: 'Configure Targeting', action: 'CONFIGURE_TARGETING', priority: 'HIGH' });
});

test('campaign workflow: ready targeting with no members resolves to READY_FOR_DISCOVERY', () => {
  const stage = resolveCampaignWorkflowStage({ targetingReady: true, memberCount: 0 });
  assert.equal(stage, 'READY_FOR_DISCOVERY');
  assert.deepEqual(getCampaignWorkflowBlockers({ targetingReady: true, memberCount: 0 }), []);
  assert.deepEqual(getNextCampaignWorkflowAction(stage), { label: 'Run Discovery', action: 'RUN_DISCOVERY', priority: 'NORMAL' });
});

test('campaign workflow: captured members resolves to SELLERS_CAPTURED with Open Workbench as the next action', () => {
  const stage = resolveCampaignWorkflowStage({ targetingReady: true, memberCount: 43 });
  assert.equal(stage, 'SELLERS_CAPTURED');
  assert.deepEqual(getNextCampaignWorkflowAction(stage), { label: 'Open Workbench', action: 'OPEN_WORKBENCH', priority: 'NORMAL' });
});
