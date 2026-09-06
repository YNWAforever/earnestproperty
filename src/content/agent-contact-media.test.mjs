import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
const media = JSON.parse(readFileSync("src/content/agent-contact-media.json", "utf8"));
test("verified namecards and QR originals stay paired with existing public agents", () => {
  assert.equal(Object.keys(media).length, 23);
  assert.equal(media.kenneth.whatsappUrl, "https://wa.link/rzk061");
  assert.equal(media["andy-hah"].whatsappUrl, "https://wa.link/t5brm0");
  assert.equal(media["michael-wong"], undefined);
  assert.equal(media["kelvin-wu"], undefined);
  for (const [slug, row] of Object.entries(media)) {
    assert.ok(row.card.endsWith("/" + slug + ".jpg"));
    assert.ok(row.qr.endsWith("/" + slug + "-qr.png"));
    for (const [key, hash] of [
      ["card", "cardSha256"],
      ["qr", "qrSha256"],
    ])
      assert.equal(
        createHash("sha256")
          .update(readFileSync("public" + row[key]))
          .digest("hex"),
        row[hash],
      );
    assert.equal(new URL(row.whatsappUrl).hostname, "wa.link");
  }
});
test("agent contact media is reachable from profiles with direct mobile alternatives", () => {
  const component = readFileSync("src/components/site/AgentContactMedia.tsx", "utf8");
  assert.match(component, /download/);
  assert.match(component, /media.whatsappUrl/);
  assert.match(component, /onClick=\{onWhatsAppClick\}/);
  assert.match(component, /object-contain/);
  const route = readFileSync("src/routes/agents_.$slug.tsx", "utf8");
  assert.match(route, /<AgentContactMedia/);
  assert.match(route, /onWhatsAppClick=\{handleWhatsAppClick\}/);
  assert.match(route, /slug=\{profile.public_slug\}/);
});
