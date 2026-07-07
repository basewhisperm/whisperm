import { PAYSTACK_PRICING_GHS, type PaystackUpgradePort } from "@whisperm/billing-runtime";

interface PaystackInitializeResponse {
  readonly status: boolean;
  readonly message: string;
  readonly data?: { readonly authorization_url: string; readonly access_code: string; readonly reference: string };
}

const planCodeFor = (plan: string): string => {
  const key = plan.toUpperCase() as keyof typeof PAYSTACK_PRICING_GHS;
  const tier = PAYSTACK_PRICING_GHS[key];
  if (tier === undefined) throw new Error(`No Paystack plan configured for plan "${plan}"`);
  return tier.planCode;
};

export const createPaystackUpgradePort = (options: { readonly secretKey: string; readonly appUrl: string }): PaystackUpgradePort => ({
  async createCustomerAndCheckout(input) {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        plan: planCodeFor(input.plan),
        callback_url: `${options.appUrl}/settings?upgrade=success`,
        metadata: { tenantId: input.tenantId, workspaceName: input.workspaceName },
      }),
    });

    const payload = await response.json() as PaystackInitializeResponse;
    if (!response.ok || !payload.status || payload.data === undefined) {
      throw new Error(`Paystack transaction initialization failed: ${payload.message ?? response.statusText}`);
    }

    return { customerId: input.email, checkoutUrl: payload.data.authorization_url };
  },
});
