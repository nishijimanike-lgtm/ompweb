import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { RightPanel } = await jiti.import("./RightPanel.tsx");

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  globalThis.CSS ??= { escape: (value) => value };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.EventSource = class { addEventListener() {} close() {} };
  globalThis.fetch = async (_url) => {
    return {
      ok: true,
      json: async () => ({ content: "test", language: "typescript", size: 4, ok: true, app: "资源管理器" }),
    };
  };
});

afterEach(() => {
  cleanup();
  delete window.matchMedia;
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

function createProps(overrides = {}) {
  const tabs = [
    { id: "file:/workspace/foo.ts", label: "foo.ts", filePath: "/workspace/foo.ts" },
  ];
  return {
    rightPanelOpen: true,
    rightView: "file",
    onSelectView() {},
    fileTabs: tabs,
    activeFileTabId: "file:/workspace/foo.ts",
    onSelectFileTab() {},
    onCloseFileTab() {},
    onCloseOtherFileTabs() {},
    onCloseAllFileTabs() {},
    onOpenFile() {},
    onClose() {},
    rightPanelRef: { current: null },
    isCompactOverlay: false,
    isMobile: false,
    rightPanelWidth: 400,
    rightPanelResizing: false,
    onRightPanelResizeStart() {},
    onResetRightPanelWidth() {},
    onRightPanelResizeKey() {},
    revealPath: null,
    onRevealActiveFile() {},
    onMentionActiveFile() {},
    onCopyActiveFilePath() {},
    onDownloadActiveFile() {},
    onMentionLines() {},
    explorerCwd: "/workspace",
    explorerIsRepo: true,
    explorerGitCount: 0,
    explorerRefreshing: false,
    onExplorerRefresh() {},
    fileSearchOpen: false,
    onToggleFileSearch() {},
    gitBadge: 0,
    unreadNotifications: 0,
    ...overrides,
  };
}

test("RightPanel renders 'Reveal in File Explorer' button when viewing a file", () => {
  render(React.createElement(RightPanel, createProps({ rightView: "file" })));

  const buttons = screen.getAllByRole("button");
  const revealBtn = buttons.find((btn) =>
    btn.title === "在文件浏览器中打开" ||
    btn.title === "Reveal in File Explorer" ||
    btn.getAttribute("aria-label") === "在文件浏览器中打开" ||
    btn.getAttribute("aria-label") === "Reveal in File Explorer"
  );

  assert.ok(revealBtn, "Reveal in File Explorer button must be rendered in file view");
});

test("RightPanel renders 'Reveal in File Explorer' button when in explorer view", () => {
  render(React.createElement(RightPanel, createProps({ rightView: "explorer" })));

  const buttons = screen.getAllByRole("button");
  const revealBtn = buttons.find((btn) =>
    btn.title === "在文件浏览器中打开" ||
    btn.title === "Reveal in File Explorer" ||
    btn.getAttribute("aria-label") === "在文件浏览器中打开" ||
    btn.getAttribute("aria-label") === "Reveal in File Explorer"
  );

  assert.ok(revealBtn, "Reveal in File Explorer button must be rendered in explorer view");
});

test("clicking 'Reveal in File Explorer' in file view calls open-app with file path and does not toast success", async () => {
  let fetchCalledWith = null;
  globalThis.fetch = async (url, opts) => {
    fetchCalledWith = { url, ...opts };
    return {
      ok: true,
      json: async () => ({ ok: true, app: "资源管理器" }),
    };
  };

  render(React.createElement(RightPanel, createProps({ rightView: "file" })));

  const buttons = screen.getAllByRole("button");
  const revealBtn = buttons.find((btn) =>
    btn.title === "在文件浏览器中打开" ||
    btn.title === "Reveal in File Explorer" ||
    btn.getAttribute("aria-label") === "在文件浏览器中打开" ||
    btn.getAttribute("aria-label") === "Reveal in File Explorer"
  );

  assert.ok(revealBtn);
  fireEvent.click(revealBtn);

  // Wait for the async click handler
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(fetchCalledWith);
  assert.equal(fetchCalledWith.url, "/api/files/open-app");
  const body = JSON.parse(fetchCalledWith.body);
  assert.equal(body.filePath, "/workspace/foo.ts");
  assert.equal(body.app, "explorer");
});
