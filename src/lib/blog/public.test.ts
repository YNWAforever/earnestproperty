import { expect, test } from "bun:test";
import { parseBlogSearch } from "./public";

test("category inputs retain exact keys and decode once; malformed inputs fail closed", () => {
  expect(parseBlogSearch({ category: "成交分析" })).toEqual({ category: "成交分析", page: 1 });
  expect(parseBlogSearch({ category: encodeURIComponent("成交分析"), page: "2" })).toEqual({
    category: "成交分析",
    page: 2,
  });
  expect(parseBlogSearch({})).toEqual({ page: 1 });
  expect(parseBlogSearch({ category: "全部" })).toEqual({ page: 1 });
  expect(parseBlogSearch({ category: "未知" }).category).toBe("未知");
  for (const category of [[], {}, 1, "%", "%2525", ""])
    expect(() => parseBlogSearch({ category })).toThrow();
  for (const page of [0, -1, "1.2", "2x", [], {}, Infinity, "", "01", 1e20])
    expect(() => parseBlogSearch({ page })).toThrow();
});
