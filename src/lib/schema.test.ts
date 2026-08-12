import { describe, expect, test } from "bun:test";

import { jsonLdScript } from "./schema";

// Behavioural counterpart to schema.test.mjs, which can only regex the source.
// These assert what jsonLdScript actually produces, because the whole point of
// the helper is that its output is inert inside a <script> element.
describe("jsonLdScript", () => {
  test("neutralises a </script> breakout in a string value", () => {
    const payload = { name: "</script><img src=x onerror=alert(1)>" };
    const out = jsonLdScript(payload);

    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("\\u003c");
  });

  test("escapes angle brackets and ampersands wherever they appear", () => {
    const out = jsonLdScript({ a: "<", b: ">", c: "&" });

    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toBe('{"a":"\\u003c","b":"\\u003e","c":"\\u0026"}');
  });

  test("escapes breakouts hidden in object keys, not just values", () => {
    const out = jsonLdScript({ "</script>": 1 });

    expect(out).not.toContain("</script>");
  });

  test("escapes breakouts nested in arrays and sub-objects", () => {
    const out = jsonLdScript({
      "@graph": [{ itemListElement: [{ name: "</script>" }] }],
    });

    expect(out).not.toContain("</script>");
  });

  // The escapes must survive a round-trip: Google's parsers unescape \uXXXX
  // back to the original characters, so structured data still reads correctly.
  test("round-trips to the original value through JSON.parse", () => {
    const payload = {
      name: "深井 <Villa> & 海濱花園",
      description: "</script> should survive as text",
    };

    expect(JSON.parse(jsonLdScript(payload))).toEqual(payload);
  });

  test("produces valid JSON for the shapes the routes actually emit", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", itemListElement: [] },
        { "@type": "RealEstateAgent", name: "晉誠地產 Earnest Property" },
      ],
    };

    expect(() => JSON.parse(jsonLdScript(graph))).not.toThrow();
  });
});
