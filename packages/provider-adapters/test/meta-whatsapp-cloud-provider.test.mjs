import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/whatsapp/meta-whatsapp-cloud-provider.ts", import.meta.url), "utf8");
const exportsSource = readFileSync("packages/provider-adapters/src/index.ts", "utf8");

test("Meta WhatsApp Cloud provider uses Graph API template messages", () => {
  assert.match(source, /class MetaWhatsAppCloudProvider/u);
  assert.match(source, /graph\.facebook\.com/u);
  assert.match(source, /messaging_product: "whatsapp"/u);
  assert.match(source, /type: "template"/u);
  assert.match(source, /seller_invitation_v1/u);
});

test("Meta WhatsApp Cloud provider supports environment aliases", () => {
  assert.match(source, /META_WHATSAPP_ACCESS_TOKEN/u);
  assert.match(source, /WHATSAPP_CLOUD_API_TOKEN/u);
  assert.match(source, /META_WHATSAPP_PHONE_NUMBER_ID/u);
  assert.match(source, /WHATSAPP_CLOUD_PHONE_NUMBER_ID/u);
});

test("provider-adapters exports Meta WhatsApp Cloud provider", () => {
  assert.match(exportsSource, /createMetaWhatsAppCloudProviderFromEnv/u);
  assert.match(exportsSource, /MetaWhatsAppCloudProviderOptions/u);
});
