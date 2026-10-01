import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderLoadNotice, classifyFolderLoad } from "./FolderLoadNotice";
const render = (state: Parameters<typeof FolderLoadNotice>[0]["state"]) =>
  renderToStaticMarkup(createElement(FolderLoadNotice, { state, onRetry: () => {} }));

test("Folder empty is setup guidance, not a network or permission failure", () => {
  const html = render({ kind: "empty" });
  expect(html).toContain("尚未設定已核實 Folder");
  expect(html).not.toContain("沒有權限");
});
test("Folder 403 has distinct forbidden state and retry", () => {
  const state = classifyFolderLoad({ status: 403, requestId: "safe-ref-1" });
  expect(state.kind).toBe("forbidden");
  const html = render(state);
  expect(html).toContain("沒有權限");
  expect(html).toContain("safe-ref-1");
  expect(html).toContain("重新載入 Folder");
});
test("Folder timeout is error, never an empty selectable list", () => {
  const state = classifyFolderLoad(new Error("timeout"));
  expect(state.kind).toBe("error");
  const html = render(state);
  expect(html).toContain("暫時無法載入");
  expect(html).not.toContain("尚未設定已核實 Folder");
});
