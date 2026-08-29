# P1c — Layout Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the ten `src/components/layout/` primitives the master plan calls for
— `Container`, `Section`, `SectionHeading`, `Prose`, `Stat`, `EmptyState`, `DataNote`,
`FreshnessStamp`, `VerificationBadge`, `SkeletonBlock` — so P3–P7 stop hand-repeating
layout/spacing markup across 79 route files.

**Architecture:** `src/components/ui/` (vendored shadcn) stays untouched — these are new,
app-specific compositions in a sibling `src/components/layout/` directory, built the
same way this repo already builds `src/components/ui/card.tsx` and `badge.tsx`:
`React.forwardRef`, a local `cn()` helper for class merging, `class-variance-authority`
only where there's genuine variant branching (`Section`'s tone, matching `Badge`'s
existing pattern), and a polymorphic `as`/heading-level prop where a component renders
text at more than one semantic level (matching `CardTitle`'s existing precedent).
`SkeletonBlock` composes the existing `src/components/ui/skeleton.tsx` `Skeleton`
primitive rather than duplicating it. `FreshnessStamp` calls `formatFreshness` from
`src/lib/format.ts` (P1a) — this is the one primitive with a real dependency on that
plan.

**Tech Stack:** React 19, `class-variance-authority`, Tailwind v4, `bun:test` +
`cheerio` + `react-dom/server` (this repo's existing component-test pattern — no
`@testing-library/react` anywhere in this codebase).

**Prerequisite:** P1a (`docs/superpowers/plans/2026-08-29-frontend-revamp-p1a-format-lib.md`)
must be merged first — `FreshnessStamp` imports `formatFreshness` from `src/lib/format.ts`.
Every other primitive here has no dependency on P1a or P1b and could technically be
built first, but this repo's `feat/frontend-revamp` integration branch is expected to
land P1a → P1b → this plan in that order per the master plan's phase sequencing.

---

## File Structure

- **Create:** `src/components/layout/Container.tsx`
- **Create:** `src/components/layout/Section.tsx`
- **Create:** `src/components/layout/SectionHeading.tsx`
- **Create:** `src/components/layout/Prose.tsx`
- **Create:** `src/components/layout/Stat.tsx`
- **Create:** `src/components/layout/EmptyState.tsx`
- **Create:** `src/components/layout/SkeletonBlock.tsx`
- **Create:** `src/components/layout/DataNote.tsx`
- **Create:** `src/components/layout/FreshnessStamp.tsx`
- **Create:** `src/components/layout/VerificationBadge.tsx`
- **Create:** `src/components/layout/layout.test.tsx` — one `bun test` file covering all ten.
- **Modify:** `package.json` — add `"test:layout": "bun test src/components/layout/layout.test.tsx"`.

None of these files exist yet (`src/components/layout/` is a green-field directory,
confirmed absent during research for this plan). No existing route or component is
modified — wiring these into actual routes is P3 onward, not this plan.

---

## Task 1: `Container` and `Section`

**Files:**
- Create: `src/components/layout/Container.tsx`
- Create: `src/components/layout/Section.tsx`
- Test: `src/components/layout/layout.test.tsx` (new file — this task writes its first block)

- [ ] **Step 1: Write the failing tests**

Create `src/components/layout/layout.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Container } from "./Container";
import { Section } from "./Section";

function render(node: ReturnType<typeof createElement>) {
  return load(renderToStaticMarkup(node));
}

describe("Container", () => {
  test("renders a div with the page-width and padding classes", () => {
    const $ = render(createElement(Container, { "data-testid": "container" }, "content"));
    const el = $('[data-testid="container"]');
    expect(el).toHaveLength(1);
    expect(el.hasClass("mx-auto")).toBe(true);
    expect(el.hasClass("max-w-7xl")).toBe(true);
    expect(el.text()).toBe("content");
  });

  test("merges a caller-supplied className instead of overwriting the base classes", () => {
    const $ = render(
      createElement(Container, { "data-testid": "container", className: "bg-card" }, "x"),
    );
    const el = $('[data-testid="container"]');
    expect(el.hasClass("mx-auto")).toBe(true);
    expect(el.hasClass("bg-card")).toBe(true);
  });
});

describe("Section", () => {
  test("defaults to the plain tone with vertical padding and no border/background", () => {
    const $ = render(createElement(Section, { "data-testid": "section" }, "content"));
    const el = $('[data-testid="section"]');
    expect(el.prop("tagName")).toBe("SECTION");
    expect(el.hasClass("py-12")).toBe(true);
    expect(el.hasClass("border-b")).toBe(false);
  });

  test("the muted tone adds the border and muted background", () => {
    const $ = render(
      createElement(Section, { "data-testid": "section", tone: "muted" }, "content"),
    );
    const el = $('[data-testid="section"]');
    expect(el.hasClass("border-b")).toBe(true);
    expect(el.hasClass("bg-muted/30")).toBe(true);
  });

  test("the card tone adds the card surface treatment", () => {
    const $ = render(createElement(Section, { "data-testid": "section", tone: "card" }, "x"));
    const el = $('[data-testid="section"]');
    expect(el.hasClass("bg-card")).toBe(true);
    expect(el.hasClass("border-y")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: FAIL — `error: Cannot find module './Container'` (and `'./Section'`).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/layout/Container.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Container = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mx-auto max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />
  ),
);
Container.displayName = "Container";

export { Container };
```

Create `src/components/layout/Section.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const sectionVariants = cva("py-12 sm:py-14", {
  variants: {
    tone: {
      plain: "",
      muted: "border-b bg-muted/30",
      card: "border-y border-border bg-card",
    },
  },
  defaultVariants: {
    tone: "plain",
  },
});

export interface SectionProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {}

const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ className, tone, ...props }, ref) => (
    <section ref={ref} className={cn(sectionVariants({ tone }), className)} {...props} />
  ),
);
Section.displayName = "Section";

export { Section, sectionVariants };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Container.tsx src/components/layout/Section.tsx src/components/layout/layout.test.tsx
git commit -m "feat(layout): add Container and Section primitives

Container: mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 -- the exact wrapper
already hand-repeated across every route (contact.tsx, transactions.tsx,
SiteFooter.tsx, etc.). Section: vertical padding plus a plain/muted/card
tone variant matching the border/background treatments already in use."
```

---

## Task 2: `SectionHeading` and `Prose`

**Files:**
- Create: `src/components/layout/SectionHeading.tsx`
- Create: `src/components/layout/Prose.tsx`
- Test: `src/components/layout/layout.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/components/layout/layout.test.tsx` (add these two imports to the top
import block, then the two `describe` blocks at the end of the file):

```tsx
import { Prose } from "./Prose";
import { SectionHeading } from "./SectionHeading";
```

```tsx
describe("SectionHeading", () => {
  test("renders the eyebrow, title, and defaults to an h2", () => {
    const $ = render(
      createElement(SectionHeading, { eyebrow: "深井放盤", title: "精選筍盤" }),
    );
    expect($("h2").text()).toBe("精選筍盤");
    expect($("p").first().text()).toBe("深井放盤");
  });

  test("renders as h3 when as='h3' is passed", () => {
    const $ = render(createElement(SectionHeading, { title: "相關屋苑", as: "h3" }));
    expect($("h3")).toHaveLength(1);
    expect($("h2")).toHaveLength(0);
  });

  test("omits the eyebrow paragraph when none is given", () => {
    const $ = render(createElement(SectionHeading, { title: "只有標題" }));
    expect($("p")).toHaveLength(0);
  });

  test("renders the action slot when provided", () => {
    const $ = render(
      createElement(SectionHeading, {
        title: "放盤",
        action: createElement("a", { href: "/listings" }, "查看全部"),
      }),
    );
    expect($('a[href="/listings"]').text()).toBe("查看全部");
  });
});

describe("Prose", () => {
  test("renders children inside a div with the prose typography classes", () => {
    const $ = render(
      createElement(
        Prose,
        { "data-testid": "prose" },
        createElement("p", null, "正文內容"),
      ),
    );
    const el = $('[data-testid="prose"]');
    expect(el).toHaveLength(1);
    expect(el.find("p").text()).toBe("正文內容");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: FAIL — `error: Cannot find module './SectionHeading'` (and `'./Prose'`).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/layout/SectionHeading.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SectionHeadingProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  as?: "h2" | "h3";
  action?: React.ReactNode;
}

const SectionHeading = React.forwardRef<HTMLDivElement, SectionHeadingProps>(
  ({ className, eyebrow, title, as: Heading = "h2", action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-end justify-between gap-4", className)}
      {...props}
    >
      <div>
        {eyebrow ? <p className="text-sm font-semibold text-primary">{eyebrow}</p> : null}
        <Heading className="mt-1 text-2xl font-bold tracking-tight text-primary sm:text-3xl">
          {title}
        </Heading>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  ),
);
SectionHeading.displayName = "SectionHeading";

export { SectionHeading };
```

Create `src/components/layout/Prose.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Prose = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "max-w-none text-base leading-8 text-foreground",
        "[&>h2]:mt-8 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:tracking-tight [&>h2]:text-primary",
        "[&>h3]:mt-6 [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:text-primary",
        "[&>p]:mt-4 [&>ul]:mt-4 [&>ul]:list-disc [&>ul]:pl-6 [&>a]:text-primary [&>a]:underline",
        className,
      )}
      {...props}
    />
  ),
);
Prose.displayName = "Prose";

export { Prose };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: PASS — 10 tests total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/SectionHeading.tsx src/components/layout/Prose.tsx src/components/layout/layout.test.tsx
git commit -m "feat(layout): add SectionHeading and Prose primitives

SectionHeading's as prop (h2 default, h3 available) follows the same
polymorphic-heading pattern already established by ui/card.tsx's
CardTitle, for the same reason: a page can only have one h2 tier per
section without breaking heading-hierarchy a11y."
```

---

## Task 3: `Stat`, `EmptyState`, and `SkeletonBlock`

**Files:**
- Create: `src/components/layout/Stat.tsx`
- Create: `src/components/layout/EmptyState.tsx`
- Create: `src/components/layout/SkeletonBlock.tsx`
- Test: `src/components/layout/layout.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

Append to the top import block:

```tsx
import { EmptyState } from "./EmptyState";
import { SkeletonBlock } from "./SkeletonBlock";
import { Stat } from "./Stat";
```

Append at the end of the file:

```tsx
describe("Stat", () => {
  test("renders the value and label", () => {
    const $ = render(createElement(Stat, { value: "23", label: "位代理" }));
    expect($("p").first().text()).toBe("23");
    expect($("p").last().text()).toBe("位代理");
  });

  test("the value uses tabular-nums so digits don't jitter in a row of stats", () => {
    const $ = render(createElement(Stat, { value: "1,234", label: "宗成交" }));
    expect($("p").first().hasClass("tabular-nums")).toBe(true);
  });
});

describe("EmptyState", () => {
  test("renders the title and description without an icon or action", () => {
    const $ = render(
      createElement(EmptyState, { title: "暫未有成交資料", description: "頁面會保持可用" }),
    );
    expect($("h2").text()).toBe("暫未有成交資料");
    expect($("p").text()).toBe("頁面會保持可用");
    expect($("svg")).toHaveLength(0);
  });

  test("renders an action when provided", () => {
    const $ = render(
      createElement(EmptyState, {
        title: "冇符合條件嘅放盤",
        action: createElement("a", { href: "/listings" }, "清除篩選"),
      }),
    );
    expect($('a[href="/listings"]').text()).toBe("清除篩選");
  });
});

describe("SkeletonBlock", () => {
  test("the default 'lines' variant renders three pulse blocks", () => {
    const $ = render(createElement(SkeletonBlock, { "data-testid": "skeleton" }));
    const el = $('[data-testid="skeleton"]');
    expect(el.find(".animate-pulse")).toHaveLength(3);
  });

  test("a custom line count is respected", () => {
    const $ = render(createElement(SkeletonBlock, { "data-testid": "skeleton", lines: 5 }));
    expect($('[data-testid="skeleton"]').find(".animate-pulse")).toHaveLength(5);
  });

  test("the 'card' variant renders an image placeholder plus two text lines", () => {
    const $ = render(
      createElement(SkeletonBlock, { "data-testid": "skeleton", variant: "card" }),
    );
    expect($('[data-testid="skeleton"]').find(".animate-pulse")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: FAIL — `error: Cannot find module './Stat'` (and `'./EmptyState'`, `'./SkeletonBlock'`).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/layout/Stat.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
}

const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ className, label, value, ...props }, ref) => (
    <div ref={ref} className={cn("text-center", className)} {...props}>
      <p className="text-3xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  ),
);
Stat.displayName = "Stat";

export { Stat };
```

`tabular-nums` is a built-in Tailwind v4 utility (font-variant-numeric) — no new CSS
token is needed for this.

Create `src/components/layout/EmptyState.tsx`, modeled directly on the empty-state
markup already hand-written in `src/routes/transactions.tsx:85-92`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon: Icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card p-8 text-center shadow-card", className)}
      {...props}
    >
      {Icon ? <Icon className="mx-auto h-8 w-8 text-primary" /> : null}
      <h2 className="mt-4 text-xl font-semibold text-primary">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
```

Create `src/components/layout/SkeletonBlock.tsx`, composing the existing
`src/components/ui/skeleton.tsx`:

```tsx
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface SkeletonBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "lines" | "card";
  lines?: number;
}

const SkeletonBlock = React.forwardRef<HTMLDivElement, SkeletonBlockProps>(
  ({ className, variant = "lines", lines = 3, ...props }, ref) => {
    if (variant === "card") {
      return (
        <div ref={ref} className={cn("overflow-hidden rounded-lg border", className)} {...props}>
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    );
  },
);
SkeletonBlock.displayName = "SkeletonBlock";

export { SkeletonBlock };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: PASS — 17 tests total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Stat.tsx src/components/layout/EmptyState.tsx src/components/layout/SkeletonBlock.tsx src/components/layout/layout.test.tsx
git commit -m "feat(layout): add Stat, EmptyState, and SkeletonBlock primitives

EmptyState is lifted directly from the hand-written pattern already in
transactions.tsx's empty state. SkeletonBlock composes the existing
ui/skeleton.tsx Skeleton rather than duplicating its animate-pulse
styling -- it adds the multi-line/card composition on top."
```

---

## Task 4: `DataNote`, `FreshnessStamp`, and `VerificationBadge`

**Files:**
- Create: `src/components/layout/DataNote.tsx`
- Create: `src/components/layout/FreshnessStamp.tsx`
- Create: `src/components/layout/VerificationBadge.tsx`
- Test: `src/components/layout/layout.test.tsx` (append)

**Note:** `FreshnessStamp` is the one primitive in this plan that depends on P1a
(`formatFreshness` from `src/lib/format.ts`) — it must be merged first.

- [ ] **Step 1: Write the failing tests**

Append to the top import block:

```tsx
import { DataNote } from "./DataNote";
import { FreshnessStamp } from "./FreshnessStamp";
import { VerificationBadge } from "./VerificationBadge";
```

Append at the end of the file:

```tsx
describe("DataNote", () => {
  test("renders the source as plain text when no sourceUrl is given", () => {
    const $ = render(createElement(DataNote, { source: "教育局學校網名冊" }));
    expect($("p").first().text()).toContain("教育局學校網名冊");
    expect($("a")).toHaveLength(0);
  });

  test("links the source when a sourceUrl is given", () => {
    const $ = render(
      createElement(DataNote, { source: "教育局學校網名冊", sourceUrl: "https://www.edb.gov.hk" }),
    );
    expect($('a[href="https://www.edb.gov.hk"]').text()).toBe("教育局學校網名冊");
  });

  test("renders the as-of date and caveat when given", () => {
    const $ = render(
      createElement(DataNote, {
        source: "教育局",
        asOf: "2026年8月",
        caveat: "實際派位以教育局最新公布為準",
      }),
    );
    expect($("p").first().text()).toContain("2026年8月");
    expect($("p").last().text()).toBe("實際派位以教育局最新公布為準");
  });
});

describe("FreshnessStamp", () => {
  test("renders a relative freshness label for a recent timestamp", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const $ = render(createElement(FreshnessStamp, { updatedAt: fiveMinutesAgo }));
    expect($("span").text()).toBe("5 分鐘前更新");
  });

  test("renders nothing for a null updatedAt, per format.ts's null-hides-the-field rule", () => {
    const html = renderToStaticMarkup(createElement(FreshnessStamp, { updatedAt: null }));
    expect(html).toBe("");
  });
});

describe("VerificationBadge", () => {
  test("renders '已核實' with the accent treatment when verified", () => {
    const $ = render(createElement(VerificationBadge, { verified: true }));
    const el = $("span").first();
    expect(el.text()).toBe("已核實");
    expect(el.hasClass("bg-accent")).toBe(true);
  });

  test("renders '待核實' with the muted treatment when not verified", () => {
    const $ = render(createElement(VerificationBadge, { verified: false }));
    const el = $("span").first();
    expect(el.text()).toBe("待核實");
    expect(el.hasClass("bg-muted")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: FAIL — `error: Cannot find module './DataNote'` (and `'./FreshnessStamp'`,
`'./VerificationBadge'`).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/layout/DataNote.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface DataNoteProps extends React.HTMLAttributes<HTMLDivElement> {
  source: React.ReactNode;
  sourceUrl?: string;
  asOf?: React.ReactNode;
  caveat?: React.ReactNode;
}

const DataNote = React.forwardRef<HTMLDivElement, DataNoteProps>(
  ({ className, source, sourceUrl, asOf, caveat, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground",
        className,
      )}
      {...props}
    >
      <p>
        資料來源：
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {source}
          </a>
        ) : (
          source
        )}
        {asOf ? <> ・ 更新於 {asOf}</> : null}
      </p>
      {caveat ? <p className="mt-1">{caveat}</p> : null}
    </div>
  ),
);
DataNote.displayName = "DataNote";

export { DataNote };
```

Create `src/components/layout/FreshnessStamp.tsx`:

```tsx
import * as React from "react";

import { formatFreshness } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FreshnessStampProps extends React.HTMLAttributes<HTMLSpanElement> {
  updatedAt: string | number | Date | null | undefined;
}

const FreshnessStamp = React.forwardRef<HTMLSpanElement, FreshnessStampProps>(
  ({ className, updatedAt, ...props }, ref) => {
    const label = formatFreshness(updatedAt);
    if (!label) return null;
    return (
      <span ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props}>
        {label}
      </span>
    );
  },
);
FreshnessStamp.displayName = "FreshnessStamp";

export { FreshnessStamp };
```

Create `src/components/layout/VerificationBadge.tsx`:

```tsx
import * as React from "react";
import { CheckCircle2, HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export interface VerificationBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  verified: boolean;
}

const VerificationBadge = React.forwardRef<HTMLSpanElement, VerificationBadgeProps>(
  ({ className, verified, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        verified ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    >
      {verified ? <CheckCircle2 className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}
      {verified ? "已核實" : "待核實"}
    </span>
  ),
);
VerificationBadge.displayName = "VerificationBadge";

export { VerificationBadge };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/components/layout/layout.test.tsx`
Expected: PASS — 24 tests total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/DataNote.tsx src/components/layout/FreshnessStamp.tsx src/components/layout/VerificationBadge.tsx src/components/layout/layout.test.tsx
git commit -m "feat(layout): add DataNote, FreshnessStamp, and VerificationBadge

These three are the DR-5/DR-9 data-trust primitives: every
market/transport/school claim in P2 onward should render through
DataNote (source + as-of + caveat) or hide, never render unattributed.
FreshnessStamp returns null (renders nothing) for a missing timestamp,
matching format.ts's null-hides-the-field convention."
```

---

## Task 5: Wire up `test:layout` and verify

**Files:**
- Modify: `package.json` (scripts block, after `"test:format"` added in P1a)

- [ ] **Step 1: Add the npm script**

In `package.json`, find the line added in P1a and add `"test:layout"` immediately
after it:

```json
    "test:format": "bun test src/lib/format.test.ts",
    "test:layout": "bun test src/components/layout/layout.test.tsx",
```

- [ ] **Step 2: Run the new script**

Run: `npm run test:layout`
Expected: PASS — 24 tests, 0 fail.

- [ ] **Step 3: Confirm this plan didn't move the P0 ratchets**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx eslint src/components/layout/`
Expected: no new problems from these ten files.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(layout): wire up npm run test:layout"
```

---

## Verification (end to end)

1. `npm run test:layout` — 24 tests pass.
2. `npm run test:format` — still 32+5 = 37 tests pass (P1a + P1b's `formatSaleDisplay`
   addition, unaffected by this plan).
3. `npx tsc --noEmit` — still 0 errors.
4. `npx eslint src/components/layout/` — no new problems.
5. `git diff --stat` against the branch this was built on shows only the eleven new
   `src/components/layout/*` files plus `package.json`.

Nothing outside `src/components/layout/` and `package.json` changed — no route wires
these primitives up yet. That's P2 onward's job as each phase touches its own routes;
this plan's job was making the primitives exist, tested, and ready to import.
