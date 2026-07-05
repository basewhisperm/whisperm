import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMessagingProviderRegistryFromEnv,
  buildSellerInvitationNotificationPorts,
} from '../dist/index.js';

const configuredEnv = {
  META_WHATSAPP_ACCESS_TOKEN: 'token',
  META_WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
  SELLER_INVITATION_SMS_PROVIDER: 'generic-http',
  SELLER_INVITATION_SMS_API_URL: 'https://sms.test/send',
  SELLER_INVITATION_SMS_API_KEY: 'sms-key',
  SELLER_INVITATION_SMS_SENDER_ID: 'WhispeRM',
  RESEND_API_KEY: 'resend-key',
};

test('ST1-013: missing configuration marks every provider UNCONFIGURED and never throws', () => {
  const logs = [];
  const registry = createMessagingProviderRegistryFromEnv({
    env: {},
    logger: { info: () => {}, warn: (m, a) => logs.push({ level: 'warn', ...a }), error: () => {} },
  });

  const health = registry.health();
  assert.equal(health.length, 3);
  for (const providerHealth of health) {
    assert.equal(providerHealth.state, 'UNCONFIGURED');
    assert.equal(providerHealth.configured, false);
    assert.equal(providerHealth.initialized, false);
    assert.equal(providerHealth.healthy, false);
    assert.equal(providerHealth.failureReason, null);
    assert.equal(typeof providerHealth.lastInitializationAt, 'string');
  }
  assert.equal(registry.getWhatsAppProvider(), undefined);
  assert.equal(registry.getSmsProvider(), undefined);
  assert.equal(registry.getEmailProvider(), undefined);
  assert.equal(registry.isAvailable('WHATSAPP'), false);
  assert.equal(registry.isAvailable('SMS'), false);
  assert.equal(registry.isAvailable('EMAIL'), false);
  // one structured warn log per unconfigured provider, never a thrown error
  assert.equal(logs.length, 3);
  assert.ok(logs.every((entry) => entry.configured === false));
});

test('ST1-013: fully configured environment brings every provider to READY with capability true', () => {
  const registry = createMessagingProviderRegistryFromEnv({ env: configuredEnv });

  for (const providerHealth of registry.health()) {
    assert.equal(providerHealth.state, 'READY');
    assert.equal(providerHealth.configured, true);
    assert.equal(providerHealth.initialized, true);
    assert.equal(providerHealth.healthy, true);
    assert.equal(providerHealth.failureReason, null);
  }
  assert.notEqual(registry.getWhatsAppProvider(), undefined);
  assert.notEqual(registry.getSmsProvider(), undefined);
  assert.notEqual(registry.getEmailProvider(), undefined);
  assert.equal(registry.isAvailable('WHATSAPP'), true);
  assert.equal(registry.isAvailable('SMS'), true);
  assert.equal(registry.isAvailable('EMAIL'), true);
});

test('ST1-013: partial configuration degrades only the unconfigured channel', () => {
  const registry = createMessagingProviderRegistryFromEnv({
    env: { META_WHATSAPP_ACCESS_TOKEN: 'token', META_WHATSAPP_PHONE_NUMBER_ID: 'phone-id' },
  });
  assert.equal(registry.isAvailable('WHATSAPP'), true);
  assert.equal(registry.isAvailable('SMS'), false);
  assert.equal(registry.isAvailable('EMAIL'), false);
});

test('ST1-013: constructing a registry initializes each provider exactly once', () => {
  let whatsappConstructions = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('should not be called during initialization'); };
  try {
    const registry = createMessagingProviderRegistryFromEnv({ env: configuredEnv });
    const first = registry.getWhatsAppProvider();
    const second = registry.getWhatsAppProvider();
    assert.equal(first, second, 'the same provider instance is returned on every access, not reconstructed');
  } finally {
    globalThis.fetch = originalFetch;
  }
  void whatsappConstructions;
});

test('ST1-013: an invalid credential shape is classified and reported as a structured failure, not a crash', () => {
  // HttpSmsProvider validates its URL synchronously; an invalid URL simulates a bad-credential-shape
  // configuration failure without making a real network call.
  const logs = [];
  const registry = createMessagingProviderRegistryFromEnv({
    env: {
      SELLER_INVITATION_SMS_PROVIDER: 'generic-http',
      SELLER_INVITATION_SMS_API_URL: 'not-a-valid-url',
      SELLER_INVITATION_SMS_API_KEY: 'sms-key',
      SELLER_INVITATION_SMS_SENDER_ID: 'WhispeRM',
    },
    logger: { info: () => {}, warn: () => {}, error: (m, a) => logs.push(a) },
  });

  const smsHealth = registry.health().find((entry) => entry.provider === 'SMS');
  assert.equal(smsHealth.state, 'FAILED');
  assert.equal(smsHealth.healthy, false);
  assert.notEqual(smsHealth.failureReason, null);
  assert.equal(typeof smsHealth.failureReason.category, 'string');
  assert.equal(registry.getSmsProvider(), undefined);
  assert.equal(registry.isAvailable('SMS'), false);
  assert.equal(logs.length, 1);
});

test('ST1-013: buildSellerInvitationNotificationPorts wires capability from the registry, not raw env checks', () => {
  const registry = createMessagingProviderRegistryFromEnv({ env: configuredEnv });
  const notifications = buildSellerInvitationNotificationPorts(registry, {
    ...configuredEnv,
    SELLER_INVITATION_WHATSAPP_ENABLED: 'false',
    SELLER_INVITATION_BASE_URL: 'https://app.example/claim',
  });
  assert.notEqual(notifications.whatsapp, undefined);
  assert.notEqual(notifications.sms, undefined);
  assert.notEqual(notifications.email, undefined);
  assert.equal(notifications.whatsappEnabled, false);
  assert.equal(notifications.inviteBaseUrl, 'https://app.example/claim');
});

test('ST1-013: buildSellerInvitationNotificationPorts omits ports the registry could not initialize', () => {
  const registry = createMessagingProviderRegistryFromEnv({ env: {} });
  const notifications = buildSellerInvitationNotificationPorts(registry, {});
  assert.equal(notifications.whatsapp, undefined);
  assert.equal(notifications.sms, undefined);
  assert.equal(notifications.email, undefined);
});
