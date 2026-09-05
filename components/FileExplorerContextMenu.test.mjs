import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { FileExplorerContextMenu } = await jiti.import("./FileExplorerContextMenu.tsx");

function renderContextMenu(props = {}) {
  return renderToStaticMarkup(
    React.createElement(FileExplorerContextMenu, {
      target: { name: "test.md", fullPath: "/tmp/project/test.md", isDir: false },
      x: 100,
      y: 100,
      cwd: "/tmp/project",
      onClose() {},
      onOpenInNewTab() {},
      onOpenToSide() {},
      ...props,
    }),
  );
}

test("renders all context menu items for a file", () => {
  const html = renderContextMenu();
  assert.match(html, /在新 Tab 中打开|Open in New Tab/);
  assert.match(html, /在侧边打开|Open to the Side/);
  assert.match(html, /在应用中打开|Open in Application/);
  assert.match(html, /下载|Download/);
  assert.match(html, /复制相对地址|Copy Relative Path/);
  assert.match(html, /复制绝对地址|Copy Absolute Path/);
});

test("disables download button for directories", () => {
  const fileHtml = renderContextMenu({
    target: { name: "docs", fullPath: "/tmp/project/docs", isDir: true },
  });
  // Disabled attribute should be present
  assert.match(fileHtml, /disabled=""/);
});
