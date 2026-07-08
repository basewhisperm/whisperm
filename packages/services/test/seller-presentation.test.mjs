import assert from 'node:assert/strict';
import test from 'node:test';
import { sellerPresentation } from '@whisperm/services';

// A minimal SellerPresentationInput-shaped fixture. Defaults to a
// fully-formed, phone-ready, invitation-ready seller so each test only
// overrides the field it is actually exercising.
const seller = (overrides = {}) => ({
  capture: {
    sellerName: 'Kwame Mensah',
    title: 'Toyota Corolla 2018',
    price: 45000,
    currency: 'GHS',
    marketplaceSourceId: 'jiji-ghana',
    capturedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    metadata: {},
  },
  contact: { phone: '+233241234567' },
  draftInventory: null,
  images: ['https://example.com/car.jpg'],
  listingCount: 1,
  workflow: {
    hasDraftInventory: true,
    invitationStatus: undefined,
    hasOwnershipAttestation: false,
    hasSellerConversion: false,
    hasInventoryConversion: false,
  },
  ...overrides,
});

test('missing phone renders an intentional message and blocks the workflow', () => {
  const presentation = sellerPresentation(seller({ contact: {} }));
  assert.equal(presentation.hasPhone, false);
  assert.equal(presentation.displayPhone, 'Phone unavailable');
  assert.equal(presentation.workflowStage, 'REVIEW');
  assert.equal(presentation.primaryBlocker.reason, 'Missing phone number');
});

test('phone explicitly flagged as still required overrides a stale phone string', () => {
  const presentation = sellerPresentation(seller({ contact: { phone: '+233241234567' }, phoneRequired: true }));
  assert.equal(presentation.hasPhone, false);
  assert.equal(presentation.displayPhone, 'Phone unavailable');
});

test('missing image falls back to a null thumbnail url instead of a broken image', () => {
  const presentation = sellerPresentation(seller({ images: [] }));
  assert.equal(presentation.thumbnail.imageUrl, null);
  assert.equal(presentation.thumbnail.marketplace, presentation.displayMarketplace);
});

test('an invalid (non-http) image url is treated the same as no image', () => {
  const presentation = sellerPresentation(seller({ images: ['data:image/png;base64,broken'] }));
  assert.equal(presentation.thumbnail.imageUrl, null);
});

test('missing price renders "Price unavailable", never "Price missing" or blank', () => {
  const presentation = sellerPresentation(seller({ capture: { ...seller().capture, price: null } }));
  assert.equal(presentation.displayPrice, 'Price unavailable');
});

test('a corrupted stringified-object price is treated as missing', () => {
  const presentation = sellerPresentation(seller({ capture: { ...seller().capture, price: '[object Object]' } }));
  assert.equal(presentation.displayPrice, 'Price unavailable');
});

test('price formats with the seller currency', () => {
  const presentation = sellerPresentation(seller());
  assert.equal(presentation.displayPrice, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(45000));
});

test('a long listing title is preserved in full -- clamping is a CSS concern, not a text-truncation one', () => {
  const longTitle = 'Mercedes-Benz C300 Base C300 4MATIC AWD Sedan Full Service History One Owner';
  const presentation = sellerPresentation(seller({ capture: { ...seller().capture, title: longTitle } }));
  assert.equal(presentation.displayTitle, longTitle);
});

test('a seller with multiple rolled-up listings reports the aggregate count', () => {
  const presentation = sellerPresentation(seller({ listingCount: 4 }));
  assert.equal(presentation.listingCount, 4);
});

test('listingCount always floors to at least 1', () => {
  const presentation = sellerPresentation(seller({ listingCount: 0 }));
  assert.equal(presentation.listingCount, 1);
});

test('a fully ready seller resolves to PHONE_READY with "Queue Invitation" as the next action', () => {
  const presentation = sellerPresentation(seller());
  assert.equal(presentation.workflowStage, 'PHONE_READY');
  assert.equal(presentation.nextAction.label, 'Queue Invitation');
  assert.equal(presentation.primaryBlocker, null);
});

test('a blocked seller (expired capture) surfaces exactly one primary blocker', () => {
  const presentation = sellerPresentation(seller({ workflow: { ...seller().workflow, captureStatus: 'EXPIRED' } }));
  assert.equal(presentation.primaryBlocker.reason, 'Marketplace capture expired before the seller completed the workflow');
  assert.equal(presentation.primaryBlocker.severity, 'blocking');
});

test('a converted seller resolves to CONVERTED with no blockers', () => {
  const presentation = sellerPresentation(seller({
    workflow: {
      ...seller().workflow,
      hasOwnershipAttestation: true,
      hasSellerConversion: true,
      hasInventoryConversion: true,
    },
  }));
  assert.equal(presentation.workflowStage, 'CONVERTED');
  assert.equal(presentation.nextAction.label, 'Open CRM Contact');
  assert.equal(presentation.blockers.length, 0);
});

test('an incomplete seller record renders "Unknown Seller" instead of a blank or a dash', () => {
  const presentation = sellerPresentation(seller({ contact: { phone: '+233241234567' }, capture: { ...seller().capture, sellerName: null, metadata: {} } }));
  assert.equal(presentation.displayName, 'Unknown Seller');
});

test('contact first/last name takes priority over the raw capture seller name', () => {
  const presentation = sellerPresentation(seller({ contact: { phone: '+233241234567', firstName: 'Ama', lastName: 'Owusu' } }));
  assert.equal(presentation.displayName, 'Ama Owusu');
});

test('captured age renders a human label instead of a raw timestamp', () => {
  const presentation = sellerPresentation(seller());
  assert.match(presentation.capturedAgeLabel, /^\d+h ago$/);
});

test('missing capture date renders an intentional fallback', () => {
  const presentation = sellerPresentation(seller({ capture: { ...seller().capture, capturedAt: null, createdAt: null } }));
  assert.equal(presentation.capturedAgeLabel, 'Captured age unavailable');
});

test('multiple blockers are sorted by severity so the primary blocker is the most severe', () => {
  const presentation = sellerPresentation(seller({
    contact: {},
    draftInventory: null,
    workflow: { ...seller().workflow, invitationStatus: 'FAILED' },
  }));
  assert.equal(presentation.primaryBlocker.severity, 'blocking');
  assert.ok(presentation.secondaryBlockerCount >= 1);
});
