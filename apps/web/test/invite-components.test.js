import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// This harness transpiles the *real* component source (invite-panel.tsx /
// inline-invite-button.tsx) with a minimal fake "react" + "react/jsx-runtime"
// swapped in, so the tests exercise the actual fetch -> invitationResponseFromFetch
// -> setState code path instead of regex-matching the source file.

const componentsDir = new URL("../src/components/seller-acquisition/", import.meta.url).pathname;
const invitationResponseUrl = new URL("../src/lib/seller-acquisition/invitation-response.js", import.meta.url).href;

const writeReactStubs = (tempDir) => {
  writeFileSync(
    join(tempDir, "react.mjs"),
    [
      "export function useState(initial) {",
      "  const store = globalThis.__hookStore;",
      "  const i = store.index++;",
      "  if (i >= store.values.length) store.values[i] = typeof initial === 'function' ? initial() : initial;",
      "  const setState = (value) => {",
      "    store.values[i] = typeof value === 'function' ? value(store.values[i]) : value;",
      "  };",
      "  return [store.values[i], setState];",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(tempDir, "jsx-runtime.mjs"),
    [
      "const make = (type, props) => ({ type, props: props ?? {} });",
      "export function jsx(type, props) { return make(type, props); }",
      "export function jsxs(type, props) { return make(type, props); }",
      "export const Fragment = Symbol('Fragment');",
      "",
    ].join("\n"),
  );
  writeFileSync(join(tempDir, "channel-selector.mjs"), "export function ChannelSelector() { return null; }\n");
};

const loadComponent = async (fileName, exportName) => {
  const tempDir = join(tmpdir(), `whisperm-invite-component-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeReactStubs(tempDir);

  const source = readFileSync(join(componentsDir, fileName), "utf8")
    .replace(/from "react"/gu, `from "${join(tempDir, "react.mjs")}"`)
    .replace(/from "\.\/channel-selector"/gu, `from "${join(tempDir, "channel-selector.mjs")}"`)
    .replace(/from "@\/lib\/seller-acquisition\/invitation-response"/gu, `from "${invitationResponseUrl}"`);

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText.replace(/["']react\/jsx-runtime["']/gu, JSON.stringify(join(tempDir, "jsx-runtime.mjs")));

  const outFile = join(tempDir, "component.mjs");
  writeFileSync(outFile, transpiled);
  const module = await import(outFile);

  globalThis.__hookStore = { index: 0, values: [] };
  const render = (props) => {
    globalThis.__hookStore.index = 0;
    return module[exportName](props);
  };

  return { render, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
};

const findAll = (node, predicate, out = []) => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  if (node.props && "children" in node.props) findAll(node.props.children, predicate, out);
  return out;
};

const textOf = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node.props) return textOf(node.props.children);
  return "";
};

const statusText = (tree) => {
  const [statusNode] = findAll(tree, (node) => node.props && node.props.role === "status");
  return statusNode ? textOf(statusNode) : "";
};

const findButton = (tree) => findAll(tree, (node) => node.type === "button")[0];

const withMockFetch = async (response, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const scenarios = [
  {
    name: "successful { ok: true, data: { invitation } } response",
    response: () => new Response(JSON.stringify({ ok: true, data: { invitation: { id: "invite-1" } } }), { status: 202 }),
    expect: (text) => {
      assert.doesNotMatch(text, /Seller invitation failed/u);
      assert.match(text, /sent/iu);
    },
  },
  {
    name: "successful legacy { ok: true, invitation } response",
    response: () => new Response(JSON.stringify({ ok: true, invitation: { id: "invite-legacy" } }), { status: 200 }),
    expect: (text) => {
      assert.doesNotMatch(text, /Seller invitation failed/u);
      assert.match(text, /sent/iu);
    },
  },
  {
    name: 'failed { ok: false, error: { message: "No phone number" } } response',
    response: () => new Response(JSON.stringify({ ok: false, error: { message: "No phone number" } }), { status: 409 }),
    expect: (text) => {
      assert.match(text, /No phone number/u);
    },
  },
  {
    name: "HTTP 500 with malformed JSON",
    response: () => new Response("<html>oops</html>", { status: 500 }),
    expect: (text) => {
      assert.notEqual(text, "");
      assert.doesNotMatch(text, /<html>/u);
    },
  },
];

for (const [fileName, exportName, propsFor] of [
  ["invite-panel.tsx", "SellerAcquisitionInvitePanel", () => ({ captureId: "capture-1" })],
  ["inline-invite-button.tsx", "InlineInviteButton", () => ({ captureId: "capture-1" })],
]) {
  for (const scenario of scenarios) {
    test(`${exportName} renders ${scenario.name}`, async () => {
      const component = await loadComponent(fileName, exportName);
      try {
        await withMockFetch(scenario.response(), async () => {
          const props = propsFor();
          let tree = component.render(props);
          const button = findButton(tree);
          await button.props.onClick();
          tree = component.render(props);
          scenario.expect(statusText(tree));
        });
      } finally {
        component.cleanup();
      }
    });
  }
}

test("SellerAcquisitionInvitePanel never shows the false-failure message after a successful invite", async () => {
  const component = await loadComponent("invite-panel.tsx", "SellerAcquisitionInvitePanel");
  try {
    await withMockFetch(
      new Response(JSON.stringify({ ok: true, data: { executionId: "execution-1", status: "ACCEPTED" } }), { status: 202 }),
      async () => {
        const props = { captureId: "capture-1" };
        let tree = component.render(props);
        const button = findButton(tree);
        await button.props.onClick();
        tree = component.render(props);
        assert.doesNotMatch(statusText(tree), /Seller invitation failed/u);
      },
    );
  } finally {
    component.cleanup();
  }
});

test("InlineInviteButton never shows the false-failure message after a successful invite", async () => {
  const component = await loadComponent("inline-invite-button.tsx", "InlineInviteButton");
  try {
    await withMockFetch(
      new Response(JSON.stringify({ ok: true, data: { executionId: "execution-1", status: "ACCEPTED" } }), { status: 202 }),
      async () => {
        const props = { captureId: "capture-1" };
        let tree = component.render(props);
        const button = findButton(tree);
        await button.props.onClick();
        tree = component.render(props);
        assert.doesNotMatch(statusText(tree), /Seller invitation failed/u);
      },
    );
  } finally {
    component.cleanup();
  }
});
