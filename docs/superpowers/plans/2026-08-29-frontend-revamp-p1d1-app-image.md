# P1d1 — `AppImage` Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/components/media/AppImage.tsx` — the single image component that
replaces every raw `<img>` on public routes, enforcing `width`/`height` (fixes the
missing-dimension CLS/a11y gap in DR-7), pinning `loading`/`decoding` defaults, and
rendering a branded fallback instead of a broken image whenever `src` is missing or
fails to load.

**Architecture:** A thin wrapper around a real `<img>` element (not `<picture>` — the
existing `src/routes/agents.contract.test.mjs:178` test scans rendered markup for
`<img` tags via regex, and this repo has no image-CDN with a documented resize-URL
scheme to justify generating `srcSet` candidates, so there's nothing to wrap in
`<picture>` yet). `width`/`height` are required at the TypeScript level, not just
convention. `src`, plus a client-side `onError` handler, both route to the same
internal fallback state, so callers no longer need their own `cover ? <img/> : <div/>`
ternary — they pass `src` unconditionally and `AppImage` decides whether to render the
image or the fallback.

**Tech Stack:** React 19, `bun:test` + `cheerio` + `react-dom/server` (this repo's
existing pattern). One caveat, stated up front: `renderToStaticMarkup` is
server-side-only and cannot fire a real `onerror` DOM event, and this repo has no
jsdom/`@testing-library/react` setup to simulate one. The `onError`-triggered runtime
fallback (an image whose `src` 404s *after* mount) is therefore covered by a manual
verification step in this plan, not an automated test — see Task 1, Step 1's note and
the Verification section. Every other behavior (missing `src` at render time, prop
defaults, fallback content, prop overrides) is covered by a real, automated test.

**Prerequisite:** None — this plan has no dependency on P1a/P1b/P1c. It could be built
in parallel with them.

---

## File Structure

- **Create:** `src/components/media/AppImage.tsx`
- **Create:** `src/components/media/AppImage.test.tsx`
- **Modify:** `package.json` — add `"test:media": "bun test src/components/media/AppImage.test.tsx"`.

`src/components/media/` doesn't exist yet (confirmed absent during research for this
plan; note `src/lib/media/` is a separate, unrelated existing directory — no naming
collision). No existing route is modified by this plan — the 24-site rollout is
`docs/superpowers/plans/2026-08-29-frontend-revamp-p1d2-app-image-rollout.md` (a
follow-up plan, not yet written).

---

## Task 1: `AppImage` component and its automated tests

**Files:**
- Create: `src/components/media/AppImage.tsx`
- Create: `src/components/media/AppImage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/media/AppImage.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppImage } from "./AppImage";

function render(node: ReturnType<typeof createElement>) {
  return load(renderToStaticMarkup(node));
}

describe("AppImage", () => {
  test("renders an img with src, alt, width, and height", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/photo.jpg",
        alt: "深井海景單位",
        width: 800,
        height: 600,
      }),
    );
    const img = $("img");
    expect(img).toHaveLength(1);
    expect(img.attr("src")).toBe("https://example.com/photo.jpg");
    expect(img.attr("alt")).toBe("深井海景單位");
    expect(img.attr("width")).toBe("800");
    expect(img.attr("height")).toBe("600");
  });

  test("defaults to loading=lazy and decoding=async", () => {
    const $ = render(
      createElement(AppImage, { src: "https://example.com/a.jpg", alt: "a", width: 1, height: 1 }),
    );
    const img = $("img");
    expect(img.attr("loading")).toBe("lazy");
    expect(img.attr("decoding")).toBe("async");
  });

  test("respects an explicit loading='eager' override for LCP candidates", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/a.jpg",
        alt: "a",
        width: 1,
        height: 1,
        loading: "eager",
      }),
    );
    expect($("img").attr("loading")).toBe("eager");
  });

  test("renders the default branded fallback and no img tag when src is null", () => {
    const $ = render(createElement(AppImage, { src: null, alt: "a", width: 1, height: 1 }));
    expect($("img")).toHaveLength(0);
    expect($.text()).toBe("晉誠地產");
  });

  test("renders the default branded fallback and no img tag when src is undefined", () => {
    const $ = render(createElement(AppImage, { src: undefined, alt: "a", width: 1, height: 1 }));
    expect($("img")).toHaveLength(0);
    expect($.text()).toBe("晉誠地產");
  });

  test("renders a caller-supplied fallback instead of the default when src is missing", () => {
    const $ = render(
      createElement(AppImage, {
        src: null,
        alt: "a",
        width: 1,
        height: 1,
        fallback: createElement("span", { "data-testid": "custom-fallback" }, "無相片"),
      }),
    );
    expect($('[data-testid="custom-fallback"]').text()).toBe("無相片");
    expect($.text()).not.toContain("晉誠地產");
  });

  test("defaults to object-cover but a caller className can override it to object-contain", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/logo.png",
        alt: "logo",
        width: 60,
        height: 60,
        className: "h-14 w-14 object-contain",
      }),
    );
    const img = $("img");
    expect(img.hasClass("object-contain")).toBe(true);
    expect(img.hasClass("object-cover")).toBe(false);
  });

  test("passes through arbitrary img attributes such as fetchPriority", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/logo.png",
        alt: "logo",
        width: 60,
        height: 60,
        fetchPriority: "high",
      }),
    );
    expect($("img").attr("fetchpriority")).toBe("high");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/components/media/AppImage.test.tsx`
Expected: FAIL — `error: Cannot find module './AppImage'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/media/AppImage.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface AppImageProps
  extends Omit<
    React.ImgHTMLAttributes<HTMLImageElement>,
    "src" | "alt" | "width" | "height" | "loading"
  > {
  src: string | null | undefined;
  alt: string;
  width: number;
  height: number;
  loading?: "eager" | "lazy";
  fallback?: React.ReactNode;
}

const DEFAULT_FALLBACK = (
  <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
    晉誠地產
  </div>
);

const AppImage = React.forwardRef<HTMLImageElement, AppImageProps>(
  (
    {
      src,
      alt,
      width,
      height,
      loading = "lazy",
      decoding = "async",
      className,
      fallback,
      onError,
      ...props
    },
    ref,
  ) => {
    const [failed, setFailed] = React.useState(false);

    if (!src || failed) {
      return <>{fallback ?? DEFAULT_FALLBACK}</>;
    }

    return (
      <img
        ref={ref}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        className={cn("object-cover", className)}
        onError={(event) => {
          setFailed(true);
          onError?.(event);
        }}
        {...props}
      />
    );
  },
);
AppImage.displayName = "AppImage";

export { AppImage };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/components/media/AppImage.test.tsx`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 5: Manually verify the runtime `onError` fallback (not covered by an automated test — see this plan's header)**

Add this scratch route temporarily (do not commit it) to exercise the runtime path:

```tsx
// src/routes/_scratch-appimage-test.tsx (temporary, delete after verifying)
import { createFileRoute } from "@tanstack/react-router";
import { AppImage } from "@/components/media/AppImage";

export const Route = createFileRoute("/_scratch-appimage-test")({
  component: () => (
    <div style={{ width: 200, height: 200 }}>
      <AppImage src="https://example.com/definitely-missing-404.jpg" alt="test" width={200} height={200} />
    </div>
  ),
});
```

Run: `npm run dev`, visit `/_scratch-appimage-test` in a browser.
Expected: the image request 404s, then the element swaps to the "晉誠地產" fallback
block (confirms `onError` correctly flips `failed` state and re-renders). Then delete
the scratch route file — it must not be committed.

- [ ] **Step 6: Commit**

```bash
git add src/components/media/AppImage.tsx src/components/media/AppImage.test.tsx
git commit -m "feat(media): add AppImage component

Wraps a real <img> (not <picture> -- no image-CDN resize scheme exists
in this codebase to justify srcSet generation yet, and
agents.contract.test.mjs regex-scans rendered markup for <img> tags).
width/height are required at the type level (DR-7 fix). Renders a
branded fallback, not a broken image, when src is missing or the image
fails to load at runtime."
```

---

## Task 2: Wire up `test:media`

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the npm script**

In `package.json`, add `"test:media"` next to the other new P1 test scripts (order
doesn't matter functionally; keep it alongside `test:format`/`test:layout` for
readability):

```json
    "test:format": "bun test src/lib/format.test.ts",
    "test:layout": "bun test src/components/layout/layout.test.tsx",
    "test:media": "bun test src/components/media/AppImage.test.tsx",
```

- [ ] **Step 2: Run the new script**

Run: `npm run test:media`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 3: Confirm this plan didn't move the P0 ratchets**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx eslint src/components/media/`
Expected: no new problems from these two files.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(media): wire up npm run test:media"
```

---

## Verification (end to end)

1. `npm run test:media` — 8 tests pass.
2. The manual `onError` verification in Task 1 Step 5 was performed and the scratch
   route was deleted (`git status` shows no `_scratch-appimage-test.tsx`).
3. `npx tsc --noEmit` — still 0 errors.
4. `npx eslint src/components/media/` — no new problems.
5. `git diff --stat` against the branch this was built on shows only
   `src/components/media/AppImage.tsx`, `src/components/media/AppImage.test.tsx`, and
   `package.json`.

`AppImage` is now built, tested, and ready for
`docs/superpowers/plans/2026-08-29-frontend-revamp-p1d2-app-image-rollout.md` (not yet
written) to import into the 24 catalogued raw `<img>` sites. No route changed in this
plan.
