# Navigation Copy and Hero Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three redundant Mega Menu group-purpose sentences and make the homepage Hero approximately 20% shorter at every responsive breakpoint.

**Architecture:** Keep navigation data and link descriptions in `SiteHeader.tsx`; remove only the group-level `purpose` field and its desktop panel paragraph. Preserve routes, labels, CTAs, mobile behavior, image crop, typography, and controls. Adjust only the homepage Hero container's responsive vertical padding in `index.tsx`.

**Tech Stack:** TanStack Start, React, TypeScript, Tailwind CSS, Node test runner, Vite.

## Global Constraints

- Keep every individual menu link, its description, route, CTA, and behavior unchanged.
- Reduce Hero vertical padding from `py-20`, `sm:py-28`, `lg:py-36` to `py-16`, `sm:py-24`, `lg:py-28`.
- Do not change Hero image crop, typography, controls, or content order.

---

### Task 1: Lock the copy and spacing contract

**Files:**
- Create: `src/components/site/SiteHeader.contract.test.mjs`

- [x] **Step 1: Write the failing test**

Read the real `SiteHeader.tsx` and `index.tsx` source, assert the three purpose sentences are absent while `地區與屋苑`, `買租服務`, and `市場資訊` remain, and assert the approved Hero class is present.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test src/components/site/SiteHeader.contract.test.mjs`

Expected: 2 failures because the current source still contains the purpose strings and the original Hero padding class.

### Task 2: Remove redundant Mega Menu purpose copy

**Files:**
- Modify: `src/components/site/SiteHeader.tsx`

- [x] **Step 1: Remove the unused type and data fields**

Delete `purpose: string` from `MegaMenuGroup` and delete the three `purpose` properties from `megaMenus`.

- [x] **Step 2: Remove the desktop purpose paragraph**

Delete the `menu.purpose` paragraph in `MegaMenuPanel`, leaving the featured links in a `grid gap-1` container so all routes and descriptions remain unchanged.

### Task 3: Tighten the homepage Hero

**Files:**
- Modify: `src/routes/index.tsx`

- [x] **Step 1: Apply the approved responsive spacing**

Change only the Hero inner container class to:

```tsx
className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28"
```

### Task 4: Verify and hand off

**Files:**
- Test: `src/components/site/SiteHeader.contract.test.mjs`
- Verify: `src/components/site/SiteHeader.tsx`, `src/routes/index.tsx`

- [ ] **Step 1: Run focused contract test**

Run: `node --test src/components/site/SiteHeader.contract.test.mjs`

Expected: 2 passing tests.

- [ ] **Step 2: Run relevant project checks**

Run: `npm.cmd run test:team`, targeted ESLint for the changed files, and `npm.cmd run build`.

- [ ] **Step 3: Check responsive behavior**

Open the homepage, inspect desktop and mobile navigation, open each Mega Menu, confirm no group-purpose sentence appears, and confirm the Hero is shorter without clipping its content.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/components/site/SiteHeader.tsx src/components/site/SiteHeader.contract.test.mjs src/routes/index.tsx
git commit -m "refine navigation copy and hero density"
```
