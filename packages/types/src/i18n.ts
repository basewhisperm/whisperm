import { z } from "zod";

export const workspaceCountryValues = ["GH", "US"] as const;
export const workspaceCountrySchema = z.enum(workspaceCountryValues);
export type WorkspaceCountry = z.output<typeof workspaceCountrySchema>;

export const supportedCurrencyValues = ["GHS", "USD"] as const;
export const supportedCurrencySchema = z.enum(supportedCurrencyValues);
export type SupportedCurrency = z.output<typeof supportedCurrencySchema>;

export const phoneE164Pattern = /^\+[1-9]\d{7,14}$/u;

export const validatePhoneE164 = (phone: string): boolean => phoneE164Pattern.test(phone);

export const phoneE164Schema = z.string().refine(validatePhoneE164, {
  message: "Phone number must be in E.164 format",
});

const dateFormatterByCountry: Readonly<Record<WorkspaceCountry, Intl.DateTimeFormat>> = {
  GH: new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }),
  US: new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }),
};

const currencyFormatterByCurrency: Readonly<Record<SupportedCurrency, Intl.NumberFormat>> = {
  GHS: new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
  }),
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }),
};

const toDate = (date: Date | string | number): Date => (date instanceof Date ? date : new Date(date));

export const formatDate = (date: Date | string | number, workspaceCountry: WorkspaceCountry): string =>
  dateFormatterByCountry[workspaceCountrySchema.parse(workspaceCountry)].format(toDate(date));

export const formatCurrency = (amount: number | string, currency: SupportedCurrency): string =>
  currencyFormatterByCurrency[supportedCurrencySchema.parse(currency)].format(Number(amount));

export interface CurrencyDisplayInput {
  readonly amount: number | string;
  readonly workspaceCurrency: SupportedCurrency;
  readonly multiCurrencyEnabled: boolean;
  readonly secondaryCurrency?: SupportedCurrency | undefined;
}

export const formatCurrencyDisplay = (input: CurrencyDisplayInput): readonly string[] => {
  const workspaceCurrency = supportedCurrencySchema.parse(input.workspaceCurrency);
  const primary = formatCurrency(input.amount, workspaceCurrency);
  if (!input.multiCurrencyEnabled || input.secondaryCurrency === undefined) {
    return [primary];
  }
  const secondaryCurrency = supportedCurrencySchema.parse(input.secondaryCurrency);
  if (secondaryCurrency === workspaceCurrency) {
    return [primary];
  }
  return [primary, formatCurrency(input.amount, secondaryCurrency)];
};
