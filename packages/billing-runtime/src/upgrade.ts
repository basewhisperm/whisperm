/**
 * upgrade.ts — Upgrade flow.
 * Creates billing provider customer + checkout session.
 * Provider: GH -> Paystack, others -> Stripe.
 * Customers created only on upgrade — never during trial signup.
 */
import { resolveBillingProvider } from "./providers/paystack.js";

export interface UpgradeWorkspaceContext {
  readonly tenantId: string;
  readonly country?: string | null;
  readonly ownerEmail: string;
  readonly workspaceName: string;
}
export interface StripeUpgradePort {
  createCustomerAndCheckout(input: { readonly tenantId: string; readonly email: string; readonly workspaceName: string; readonly plan: string }): Promise<{ readonly customerId: string; readonly checkoutUrl: string }>;
}
export interface PaystackUpgradePort {
  createCustomerAndCheckout(input: { readonly tenantId: string; readonly email: string; readonly workspaceName: string; readonly plan: string }): Promise<{ readonly customerId: string; readonly checkoutUrl: string }>;
}
export interface UpgradeServicePorts {
  readonly stripe: StripeUpgradePort;
  readonly paystack: PaystackUpgradePort;
}
export interface UpgradeResult {
  readonly provider: "STRIPE" | "PAYSTACK";
  readonly customerId: string;
  readonly checkoutUrl: string;
}
export const initiateUpgrade = async (
  ports: UpgradeServicePorts,
  context: UpgradeWorkspaceContext,
  plan: string,
): Promise<UpgradeResult> => {
  const provider = resolveBillingProvider({ country: context.country ?? null });
  const port = provider === "PAYSTACK" ? ports.paystack : ports.stripe;
  const result = await port.createCustomerAndCheckout({
    tenantId: context.tenantId,
    email: context.ownerEmail,
    workspaceName: context.workspaceName,
    plan,
  });
  return { provider, ...result };
};
