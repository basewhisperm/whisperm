import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appRoot = fileURLToPath(new URL("../src/", import.meta.url));

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("ChannelSelector renders supported invite channels with accessible active state", () => {
  const selector = read("components/seller-acquisition/channel-selector.tsx");

  for (const label of ["WhatsApp first", "SMS fallback", "Email optional"]) {
    assert.match(selector, new RegExp(label, "u"));
  }
  assert.match(selector, /aria-pressed=\{selected\}/u);
  assert.match(selector, /role="group"/u);
  assert.match(selector, /value: SellerAcquisitionInviteChannel/u);
  assert.match(selector, /onChange: \(channel: SellerAcquisitionInviteChannel\) => void/u);
});

test("invite panel uses ChannelSelector and preserves invite request contract", () => {
  const invitePanel = read("components/seller-acquisition/invite-panel.tsx");

  assert.match(invitePanel, /import \{ ChannelSelector/u);
  assert.match(invitePanel, /<ChannelSelector onChange=\{setChannel\} value=\{channel\} \/>/u);
  assert.match(invitePanel, /body: JSON\.stringify\(\{ preferredChannel: channel \}\)/u);
  assert.match(invitePanel, /result\.status !== "SENT"/u);
  assert.match(invitePanel, /Seller invitation failed/u);
});

test("InlineInviteButton preserves contract and only treats SENT JSON status as success", () => {
  const button = read("components/seller-acquisition/inline-invite-button.tsx");

  assert.match(button, /captureId: string/u);
  assert.match(button, /onRefresh\?: \(\) => void \| Promise<void>/u);
  assert.match(button, /const defaultPreferredChannel: SellerAcquisitionInviteChannel = "WHATSAPP"/u);
  assert.match(button, /body: JSON\.stringify\(\{ preferredChannel: defaultPreferredChannel \}\)/u);
  assert.match(button, /!response\.ok \|\| result\.status !== "SENT"/u);
  assert.match(button, /setState\("error"\)/u);
  assert.match(button, /setState\("sent"\)/u);
  assert.match(button, /await onRefresh\?\.\(\)/u);
});

test("acquisition board integration only applies when the board component exists", () => {
  const boardPath = join(appRoot, "components/seller-acquisition/acquisition-board.tsx");
  if (!existsSync(boardPath)) {
    assert.ok(true, "acquisition board component is not present yet");
    return;
  }

  const board = read("components/seller-acquisition/acquisition-board.tsx");
  assert.match(board, /InlineInviteButton/u);
  assert.match(board, /stageName === "Captured"/u);
  assert.match(board, /captureId/u);
});
