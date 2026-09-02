import assert from 'node:assert/strict';
import test from 'node:test';

import { ResendEmailProvider } from '../dist/index.js';

test('email provider throws when Resend resolves with an API error', async () => {
  const provider = new ResendEmailProvider({ apiKey: 're_test', from: 'WhispeRM <test@example.com>' });
  provider.client = {
    emails: {
      send: async () => ({ data: null, error: { message: 'sender domain is not verified' } }),
    },
  };

  await assert.rejects(
    provider.send({ to: 'seller@example.com', subject: 'Claim', html: '<p>Claim</p>' }),
    /Resend rejected email: sender domain is not verified/,
  );
});

test('email provider succeeds only when Resend accepts the message', async () => {
  const provider = new ResendEmailProvider({ apiKey: 're_test', from: 'WhispeRM <test@example.com>' });
  provider.client = {
    emails: {
      send: async () => ({ data: { id: 'email_123' }, error: null }),
    },
  };

  await provider.send({ to: 'seller@example.com', subject: 'Claim', html: '<p>Claim</p>' });
});
