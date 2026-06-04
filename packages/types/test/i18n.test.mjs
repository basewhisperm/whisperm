import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCurrency,
  formatCurrencyDisplay,
  formatDate,
  phoneE164Schema,
  validatePhoneE164,
} from "../dist/index.js";

const businessDate = "2026-06-01T15:30:00.000Z";

test("workspace country drives business date formatting", () => {
  assert.equal(formatDate(businessDate, "GH"), "01/06/2026");
  assert.equal(formatDate(businessDate, "US"), "06/01/2026");
});

test("business date formatting ignores browser locale defaults", () => {
  const original = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = class extends original {
      constructor(locale, options) {
        super(locale ?? "fr-FR", options);
      }
    };
    assert.equal(formatDate(businessDate, "GH"), "01/06/2026");
    assert.equal(formatDate(businessDate, "US"), "06/01/2026");
  } finally {
    Intl.DateTimeFormat = original;
  }
});

test("currency formatting uses Intl.NumberFormat for USD and GHS", () => {
  assert.equal(formatCurrency(1000, "USD"), new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(1000));
  assert.equal(formatCurrency(1000, "GHS"), new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(1000));
});

test("multi-currency display includes secondary currency only when enabled", () => {
  assert.deepEqual(formatCurrencyDisplay({ amount: 1000, workspaceCurrency: "GHS", secondaryCurrency: "USD", multiCurrencyEnabled: true }), [formatCurrency(1000, "GHS"), formatCurrency(1000, "USD")]);
  assert.deepEqual(formatCurrencyDisplay({ amount: 1000, workspaceCurrency: "GHS", secondaryCurrency: "USD", multiCurrencyEnabled: false }), [formatCurrency(1000, "GHS")]);
});

test("E.164 phone validation accepts only canonical storage format", () => {
  assert.equal(validatePhoneE164("+233555555555"), true);
  assert.equal(validatePhoneE164("+14155551234"), true);
  for (const phone of ["0241234567", "(415)555-1234", "12345"]) {
    assert.equal(validatePhoneE164(phone), false);
    assert.throws(() => phoneE164Schema.parse(phone), /E\.164/u);
  }
});
