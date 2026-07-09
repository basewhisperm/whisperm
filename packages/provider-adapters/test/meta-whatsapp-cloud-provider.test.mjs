import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MetaWhatsAppCloudProvider, ProviderDeliveryError } from "../dist/index.js";

const source = readFileSync(new URL("../src/whatsapp/meta-whatsapp-cloud-provider.ts", import.meta.url), "utf8");
const exportsSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const baseOptions = () => ({ accessToken: "token", phoneNumberId: "phone-id" });
const jsonResponse = (status, body) => ({ ok: false, status, text: async () => JSON.stringify(body) });

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

test("zero body params sends a template with no body component", async () => {
  let sentBody;
  const fetchImpl = async (_url, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 200, text: async () => "" }; };
  const provider = new MetaWhatsAppCloudProvider({ ...baseOptions(), templateBodyParamCount: 0, fetchImpl });

  await provider.send({ to: "+233501234567", body: "https://app.example/claim/token123" });

  assert.deepEqual(sentBody.template.components, []);
});

test("one body param sends exactly one body parameter", async () => {
  let sentBody;
  const fetchImpl = async (_url, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 200, text: async () => "" }; };
  const provider = new MetaWhatsAppCloudProvider({ ...baseOptions(), templateBodyParamCount: 1, fetchImpl });

  await provider.send({ to: "+233501234567", body: "https://app.example/claim/token123" });

  assert.equal(sentBody.template.components.length, 1);
  assert.equal(sentBody.template.components[0].type, "body");
  assert.deepEqual(sentBody.template.components[0].parameters, [{ type: "text", text: "https://app.example/claim/token123" }]);
});

test("template body param count defaults to one when unset, preserving prior behavior", async () => {
  let sentBody;
  const fetchImpl = async (_url, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 200, text: async () => "" }; };
  const provider = new MetaWhatsAppCloudProvider({ ...baseOptions(), fetchImpl });

  await provider.send({ to: "+233501234567", body: "hello" });

  assert.equal(sentBody.template.components.length, 1);
});

test("unsupported multi-param template fails preflight at construction", () => {
  assert.throws(
    () => new MetaWhatsAppCloudProvider({ ...baseOptions(), templateBodyParamCount: 2 }),
    /not supported without an explicit parameter mapping/u,
  );
});

test("non-integer template body param count fails preflight at construction", () => {
  assert.throws(
    () => new MetaWhatsAppCloudProvider({ ...baseOptions(), templateBodyParamCount: Number.NaN }),
    /must be a non-negative integer/u,
  );
});

test("provider error maps HTTP failure to a safe ProviderDeliveryError diagnostic", async () => {
  const fetchImpl = async () => jsonResponse(400, {
    error: { message: "Secret contact detail: +233501234567 is not opted in", type: "OAuthException", code: 131047, fbtrace_id: "trace-abc" },
  });
  const provider = new MetaWhatsAppCloudProvider({ ...baseOptions(), fetchImpl });

  await assert.rejects(
    provider.send({ to: "+233501234567", body: "hi" }),
    (error) => {
      assert.ok(error instanceof ProviderDeliveryError);
      assert.equal(error.provider, "meta_whatsapp");
      assert.equal(error.status, 400);
      assert.equal(error.safeCode, "131047");
      assert.equal(error.safeCategory, "OAuthException");
      assert.equal(error.requestId, "trace-abc");
      assert.equal(error.retryable, false);
      // The raw provider message (which may echo contact data) must never leak into the error.
      assert.doesNotMatch(error.message, /\+233501234567/u);
      assert.doesNotMatch(error.toSafeMessage(), /\+233501234567/u);
      return true;
    },
  );
});

test("server errors and rate limits are marked retryable", async () => {
  const fetchImpl = async () => jsonResponse(503, {});
  const provider = new MetaWhatsAppCloudProvider({ ...baseOptions(), fetchImpl });

  await assert.rejects(provider.send({ to: "+233501234567", body: "hi" }), (error) => {
    assert.equal(error.retryable, true);
    return true;
  });
});
