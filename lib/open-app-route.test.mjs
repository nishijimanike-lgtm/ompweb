import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": new URL("../", import.meta.url).pathname,
  },
});
const { POST } = await jiti.import("../app/api/files/open-app/route.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { NextRequest } = await jiti.import("next/server");

test("open-app route validates parameters", async () => {
  // Missing filePath
  const req1 = new NextRequest("http://localhost/api/files/open-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app: "explorer" }),
  });
  const res1 = await POST(req1);
  assert.equal(res1.status, 400);

  // Invalid app
  const req2 = new NextRequest("http://localhost/api/files/open-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: "test.txt", app: "invalid-app" }),
  });
  const res2 = await POST(req2);
  assert.equal(res2.status, 400);
});

test("open-app rejects paths outside allowed roots", async () => {
  const req = new NextRequest("http://localhost/api/files/open-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: "C:/forbidden/path/test.txt", app: "explorer" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
});

test("open-app opens allowed files with explorer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-open-app-test-"));
  const testFile = join(dir, "sample.txt");
  writeFileSync(testFile, "hello");
  allowFileRoot(dir.replace(/\\/g, "/"));

  try {
    const req = new NextRequest("http://localhost/api/files/open-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: testFile, app: "explorer" }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.app, "资源管理器");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
