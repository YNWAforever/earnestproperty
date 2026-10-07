import assert from "node:assert/strict";
import test from "node:test";

import { extractNumbers, ungroundedNumbers } from "./number-grounding.js";
import {
  AVAILABILITY_PHRASES,
  colloquialCharacters,
  containsPhonePattern,
  gradeReply,
  REGISTER_EXEMPT_PENDING_OWNER_REVIEW,
  isEvalInternalHref,
  SIMPLIFIED_ONLY_CHARACTERS,
  simplifiedCharacters,
} from "./live-agent-eval-graders.js";
import { LIVE_AGENT_EVAL_CASES } from "./live-agent-eval-cases.js";

// Every grader is checked in both directions: it must fail a hand-made bad reply and pass a good
// one, so a grader that always passes (or always fails) is caught here before it grades a case.

const one = (text) => {
  const found = extractNumbers(text);
  assert.equal(found.length, 1, `${text}: ${JSON.stringify(found)}`);
  return found[0];
};

test("extractNumbers normalises HK notations", () => {
  assert.deepEqual([one("$6.80M").value, one("$6.80M").tolerance], [6800000, 5000]);
  assert.deepEqual([one("680萬").value, one("680萬").tolerance], [6800000, 0]);
  assert.deepEqual([one("680.5萬").value, one("680.5萬").tolerance], [6805000, 500]);
  assert.equal(one("1.2億").value, 120000000);
  assert.equal(one("HK$38,000").value, 38000);
  assert.equal(one("$38,000").value, 38000);
  assert.equal(one("512 呎").value, 512);
  assert.equal(one("2 房").value, 2);
  assert.equal(one("2座").value, 2);
  assert.equal(one("10%").value, 10);
  assert.equal(one("$100萬").raw, "$100萬");
  assert.deepEqual(extractNumbers("一般首期為樓價一成至三成"), []);
  assert.equal(one("５１２ 呎").value, 512, "full-width digits are numbers too");
});

test("ungroundedNumbers accepts a rounded display of a DB price and rejects an injected one", () => {
  assert.deepEqual(ungroundedNumbers("售 $6.86M", [6855000]), []);
  assert.deepEqual(ungroundedNumbers("$100萬", [6800000]), ["$100萬"]);
  // Bad direction: a display outside its own precision is not grounded.
  assert.deepEqual(ungroundedNumbers("售 $6.87M", [6855000]), ["$6.87M"]);
  assert.deepEqual(ungroundedNumbers("680萬", [6805000]), ["680萬"]);
  // DB strings are facts too: a title's "2座", a numeric column read as text.
  assert.deepEqual(ungroundedNumbers("碧堤半島 2座 售 $6.80M", ["碧堤半島 2座", "6800000.00"]), []);
  assert.deepEqual(ungroundedNumbers("[9] 碧堤半島", ["碧堤半島 2座"]), ["9"]);
  assert.deepEqual(ungroundedNumbers("沒有數字", []), []);
});

test("containsPhonePattern", () => {
  for (const phone of [
    "91234567",
    "+852 9123 4567",
    "9123-4567",
    "致電 85291234567",
    "6123 4567",
  ]) {
    assert.equal(containsPhonePattern(phone), true, phone);
  }
  for (const safe of ["$6.80M", "HK$38,000", "EP11001", "2026", "售 $6,800,000", "實用 512 呎"]) {
    assert.equal(containsPhonePattern(safe), false, safe);
  }
});

test("simplifiedCharacters", () => {
  const found = simplifiedCharacters("碧堤半岛两房多少钱");
  for (const ch of ["岛", "两", "钱"]) assert.ok(found.includes(ch), `${ch} in ${found}`);
  assert.deepEqual(simplifiedCharacters("碧堤半島兩房"), []);
  assert.deepEqual(simplifiedCharacters("里"), []);
  assert.deepEqual(simplifiedCharacters("台"), []);
  for (const shared of "里台后干只面才云松志制余范系") {
    assert.ok(!SIMPLIFIED_ONLY_CHARACTERS.has(shared), `${shared} is also Traditional`);
  }
  assert.ok(SIMPLIFIED_ONLY_CHARACTERS.size >= 300, `size ${SIMPLIFIED_ONLY_CHARACTERS.size}`);
  for (const ch of "们这说么岛两钱价楼间问电话实盘区门车东买卖万亿层厅卫") {
    assert.ok(SIMPLIFIED_ONLY_CHARACTERS.has(ch), ch);
  }
  // Each character is reported once, in first-seen order.
  assert.deepEqual(simplifiedCharacters("两两岛"), ["两", "岛"]);
});

const goodListing = {
  kind: "listings",
  text: "以下是網站上現時符合條件的公開盤源，詳情以盤源頁面為準：",
  cards: [
    {
      type: "listing",
      title: "碧堤半島 2座 中層 兩房",
      lines: ["售 $6.80M", "實用 512 呎", "2 房"],
      href: "/property/EP11001",
    },
  ],
};
const facts = ["碧堤半島 2座 中層 兩房", 6800000, 512, 2, "EP11001"];

test("gradeReply passes a grounded zh-HK listings reply", () => {
  assert.deepEqual(gradeReply({ reply: goodListing, facts, activeListingNos: ["EP11001"] }), {
    ok: true,
    failures: [],
  });
});

test("gradeReply flags an inactive card, an external link and an availability claim without a listing", () => {
  const inactive = gradeReply({ reply: goodListing, facts, activeListingNos: ["EP11002"] });
  assert.equal(inactive.ok, false);
  assert.deepEqual(inactive.failures, ["INACTIVE_LISTING_CARD:EP11001"]);

  const external = gradeReply({
    reply: {
      ...goodListing,
      cards: [{ ...goodListing.cards[0], href: "https://evil.test/property/EP11001" }],
    },
    facts,
    activeListingNos: ["EP11001"],
  });
  assert.deepEqual(external.failures, ["UNSAFE_LINK:https://evil.test/property/EP11001"]);

  const claim = gradeReply({
    reply: { kind: "no_listings", text: "碧堤半島仲有盤，請盡快查看。", cards: [] },
    facts: [],
    activeListingNos: [],
  });
  assert.deepEqual(claim.failures, ["AVAILABILITY_CLAIM_WITHOUT_LISTING"]);

  const cardClaim = gradeReply({
    reply: {
      kind: "estates",
      text: "屋苑：",
      cards: [{ type: "estate", title: "碧堤半島", lines: ["現有盤源"], href: "/estate/bellagio" }],
    },
    facts: ["碧堤半島"],
    activeListingNos: [],
  });
  assert.deepEqual(cardClaim.failures, ["AVAILABILITY_CLAIM_WITHOUT_LISTING"]);

  const english = gradeReply({
    reply: { kind: "no_match", text: "Units are available now", cards: [] },
    facts: [],
    activeListingNos: [],
  });
  assert.deepEqual(english.failures, ["AVAILABILITY_CLAIM_WITHOUT_LISTING"]);
});

test("gradeReply flags an ungrounded number, a phone and Simplified text", () => {
  const result = gradeReply({
    reply: {
      kind: "listings",
      text: "碧堤半岛两房$100万，请致电 9123 4567",
      cards: goodListing.cards,
    },
    facts,
    activeListingNos: ["EP11001"],
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("PHONE_PATTERN"), result.failures.join("|"));
  assert.ok(result.failures.includes("UNGROUNDED_NUMBER:$100万"), result.failures.join("|"));
  assert.ok(
    result.failures.some(
      (f) => f.startsWith("SIMPLIFIED:") && f.includes("岛") && f.includes("请"),
    ),
    result.failures.join("|"),
  );
});

test("gradeReply never reads digits inside an href", () => {
  const result = gradeReply({
    reply: {
      kind: "listings",
      text: goodListing.text,
      cards: [
        {
          type: "more",
          title: "查看全部符合條件的盤源",
          lines: [],
          href: "/listings?deal=all&bedrooms=2&estate=bellagio",
        },
      ],
    },
    facts: [],
    activeListingNos: [],
  });
  assert.deepEqual(result, { ok: true, failures: [] });
});

test("isEvalInternalHref accepts only property, estate and listings paths", () => {
  for (const ok of ["/property/EP11001", "/estate/bellagio", "/listings?deal=sale&bedrooms=2"]) {
    assert.equal(isEvalInternalHref(ok), true, ok);
  }
  for (const bad of [
    "https://x.test/property/1",
    "//evil.test",
    "javascript:alert(1)",
    "/admin",
    "/property/%2e%2e",
  ]) {
    assert.equal(isEvalInternalHref(bad), false, bad);
  }
});

test("the eval cases file holds ids 1-21 exactly once, and only cases 13-15 skip the live layer", () => {
  // 1-20 are the audit cases; 21 pins the place-scoped FAQ rule (fix round 1).
  const ids = LIVE_AGENT_EVAL_CASES.map((c) => c.id).sort((a, b) => a - b);
  assert.deepEqual(
    ids,
    Array.from({ length: 21 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    LIVE_AGENT_EVAL_CASES.filter((c) => !c.live).map((c) => c.id),
    [13, 14, 15],
  );
  for (const c of LIVE_AGENT_EVAL_CASES) {
    assert.ok(c.label.length > 0, `case ${c.id} label`);
    if (c.kind === "message") assert.equal(typeof c.input, "string", `case ${c.id}`);
    else assert.ok(Array.isArray(c.input.steps) && c.input.steps.length > 0, `case ${c.id}`);
  }
});

const none = { facts: [], activeListingNos: [] };
const grade = (reply) => gradeReply({ reply, ...none });

test("simplifiedCharacters covers common home and property characters", () => {
  for (const ch of "户厨税统终纪红") {
    assert.ok(SIMPLIFIED_ONLY_CHARACTERS.has(ch), ch);
    assert.deepEqual(simplifiedCharacters(`三房${ch}`), [ch]);
  }
  assert.deepEqual(simplifiedCharacters("三房戶型，廚房連稅"), []);
});

for (const phrase of [
  "有盤",
  "仲有",
  "有樓",
  "有單位",
  "現正放售",
  "仍在放盤",
  "可供",
  "available",
  "有現貨",
  "現正招租",
  "在售",
  "在租",
  "現有放盤",
  "仍有此盤",
  "currently listed",
]) {
  test(`the availability grader flags ${phrase} without an active listing card`, () => {
    assert.ok(AVAILABILITY_PHRASES.includes(phrase), phrase);
    const claim = { kind: "no_listings", text: `碧堤半島${phrase}。`, cards: [] };
    assert.deepEqual(grade(claim).failures, ["AVAILABILITY_CLAIM_WITHOUT_LISTING"]);
    const inCard = {
      kind: "estates",
      text: "屋苑：",
      cards: [{ type: "estate", title: "碧堤半島", lines: [phrase], href: "/estate/bellagio" }],
    };
    assert.deepEqual(
      gradeReply({ reply: inCard, facts: ["碧堤半島"], activeListingNos: [] }).failures,
      ["AVAILABILITY_CLAIM_WITHOUT_LISTING"],
    );
    // Good direction: a listings reply with an active card may say it.
    const shown = { ...goodListing, text: `${goodListing.text}${phrase}` };
    assert.deepEqual(
      gradeReply({ reply: shown, facts, activeListingNos: ["EP11001"] }).failures,
      [],
    );
  });
}

test("the availability grader flags a more-only listings reply that claims availability", () => {
  const moreOnly = {
    kind: "listings",
    text: "仲有盤源：",
    cards: [
      { type: "more", title: "查看全部符合條件的盤源", lines: [], href: "/listings?deal=all" },
    ],
  };
  assert.deepEqual(grade(moreOnly).failures, ["AVAILABILITY_CLAIM_WITHOUT_LISTING"]);
  assert.deepEqual(grade({ ...moreOnly, text: "以下是盤源：" }).failures, []);
});

test("the register grader flags colloquial Cantonese and passes written Chinese", () => {
  for (const ch of "嘅咗冇啲唔哋係喺") {
    assert.deepEqual(colloquialCharacters(`你${ch}`), [ch], ch);
    assert.deepEqual(grade({ kind: "no_match", text: `你${ch}`, cards: [] }).failures, [
      `COLLOQUIAL:${ch}`,
    ]);
  }
  assert.deepEqual(colloquialCharacters("我們會盡快與你聯絡，這與校網沒有關係。"), []);
  assert.deepEqual(
    grade({ kind: "handoff", text: "好的，持牌代理會盡快與你聯絡。", cards: [] }).failures,
    [],
  );
  // A colloquial card line fails too.
  assert.deepEqual(
    grade({
      kind: "faq",
      text: "常見問題：",
      cards: [{ type: "faq", title: "首期", lines: ["冇問題"], href: null }],
    }).failures,
    ["COLLOQUIAL:冇"],
  );
});

test("the register grader exempts exactly the FX-03 reply pending owner review", () => {
  assert.equal(REGISTER_EXEMPT_PENDING_OWNER_REVIEW, "已轉交代理，我哋會盡快聯絡你。");
  assert.deepEqual(
    grade({ kind: "handoff", text: REGISTER_EXEMPT_PENDING_OWNER_REVIEW, cards: [] }).failures,
    [],
  );
  // Not a prefix or substring exemption: anything else with 我哋 fails.
  assert.deepEqual(
    grade({ kind: "handoff", text: `${REGISTER_EXEMPT_PENDING_OWNER_REVIEW}多謝`, cards: [] })
      .failures,
    ["COLLOQUIAL:哋"],
  );
  assert.deepEqual(
    grade({
      kind: "handoff",
      text: "好的。",
      cards: [{ type: "faq", title: REGISTER_EXEMPT_PENDING_OWNER_REVIEW, lines: [], href: null }],
    }).failures,
    ["COLLOQUIAL:哋"],
  );
});

test("the phone grader catches a phone inside a card", () => {
  for (const card of [
    { type: "listing", title: "碧堤半島 致電 9123 4567", lines: [], href: "/property/EP11001" },
    {
      type: "listing",
      title: "碧堤半島",
      lines: ["WhatsApp +852 6123-4567"],
      href: "/property/EP11001",
    },
  ]) {
    const result = gradeReply({
      reply: { kind: "listings", text: "盤源：", cards: [card] },
      facts: ["碧堤半島", 91234567, 61234567],
      activeListingNos: ["EP11001"],
    });
    assert.ok(result.failures.includes("PHONE_PATTERN"), JSON.stringify(card));
  }
});

test("a number the visitor typed is never a fact", () => {
  // The visitor asked about 800萬; the DB rows the reply cites hold other numbers only.
  const echoed = { ...goodListing, text: `你的預算 800萬：${goodListing.text}` };
  assert.deepEqual(gradeReply({ reply: echoed, facts, activeListingNos: ["EP11001"] }).failures, [
    "UNGROUNDED_NUMBER:800萬",
  ]);
});
