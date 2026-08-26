import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { helpdeskFilePath, removeHelpdeskFiles } from "./helpdesk-files.util";

test("helpdeskFilePath resolves under the configured HELPDESK_FILES_DIR", () => {
  process.env.HELPDESK_FILES_DIR = "/data/files/helpdesk";
  const p = helpdeskFilePath("hd-abc.webp");
  assert.equal(p, path.join("/data/files/helpdesk", "hd-abc.webp"));
});

test("helpdeskFilePath strips path traversal from the key", () => {
  process.env.HELPDESK_FILES_DIR = "/data/files/helpdesk";
  const p = helpdeskFilePath("../../etc/passwd");
  assert.equal(p, path.join("/data/files/helpdesk", "passwd"));
});

test("removeHelpdeskFiles never throws on missing files", async () => {
  process.env.HELPDESK_FILES_DIR = "/nonexistent-dir-xyz";
  await removeHelpdeskFiles(["not-there.webp", ""]);
  assert.ok(true); // reached here without throwing
});
