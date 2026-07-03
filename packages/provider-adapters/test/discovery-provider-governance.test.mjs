import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscoveryProviderError, DiscoveryProviderResolver } from '../dist/index.js';

test('discovery provider resolver resolves by marketplace source key', () => {
  const provider = { providerKey: 'jiji-provider', marketplaceSource: 'JIJI', async discover() { return { providerKey: 'jiji-provider', marketplaceSource: 'JIJI', results: [] }; } };
  const resolver = new DiscoveryProviderResolver([provider]);
  assert.equal(resolver.resolve('jiji'), provider);
});

test('discovery provider resolver rejects unsupported providers clearly', () => {
  const resolver = new DiscoveryProviderResolver([]);
  assert.throws(() => resolver.resolve('UNKNOWN'), (error) => {
    assert.equal(error instanceof DiscoveryProviderError, true);
    assert.equal(error.code, 'DISCOVERY_PROVIDER_UNSUPPORTED');
    assert.equal(error.category, 'UNSUPPORTED_PROVIDER');
    assert.equal(error.retryable, false);
    return true;
  });
});
