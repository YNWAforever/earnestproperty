import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../../routes/admin.leads.tsx", import.meta.url), "utf8");
const source = route.slice(
  route.indexOf("  async function addNote()"),
  route.indexOf("  async function markStage("),
);

function fixture() {
  const state = {
    id: "lead-1",
    draft: { stage: "viewing", note: "unsaved field" },
    note: "submitted note",
    detail: { id: "lead-1", activities: [] as string[] },
    error: null as string | null,
  };
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const updated = { id: "lead-1", activities: ["submitted note"] };
  const ports = {
    detail: { id: "lead-1", contact_id: "contact-1" },
    noteBody: state.note,
    setNoteError: () => {},
    setMutatingAction: () => {},
    createAdminLeadActivity: () => pending,
    refreshLeads: async () => {},
    canApplyLeadDetail: (id: string) => state.id === id,
    detailRequestRef: { current: 0 },
    fetchAdminLead: async () => updated,
    setDetail: (value: typeof state.detail) => {
      state.detail = value;
    },
    setDetailError: (value: string | null) => {
      state.error = value;
    },
    setNoteBody: (value: string | ((current: string) => string)) => {
      state.note = typeof value === "function" ? value(state.note) : value;
    },
    loadLeadDetail: async () => {
      state.draft = { stage: "new", note: "" };
      state.note = "";
      state.detail = updated;
      return updated;
    },
    toast: { success: () => {}, error: () => {} },
    errorText: String,
  };
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  const run = new Function(...Object.keys(ports), `${javascript}; return addNote;`)(
    ...Object.values(ports),
  );
  return { state, run, release, requestRef: ports.detailRequestRef };
}

test("saving only an internal note refreshes activities without replacing unsaved inquiry fields", async () => {
  const f = fixture();
  const savedDraft = f.state.draft;
  const pending = f.run();
  f.release();
  await pending;
  expect(f.state.draft).toBe(savedDraft);
  expect(f.state.detail.activities).toEqual(["submitted note"]);
  expect(f.state.note).toBe("");
});

test("a note edited while saving is retained", async () => {
  const f = fixture();
  const pending = f.run();
  f.state.note = "next note";
  f.release();
  await pending;
  expect(f.state.note).toBe("next note");
});

test("an old customer's note completion does not replace the newly selected customer's detail or draft", async () => {
  const f = fixture();
  const pending = f.run();
  f.state.id = "lead-2";
  f.state.detail = { id: "lead-2", activities: [] };
  f.state.note = "second customer";
  f.release();
  await pending;
  expect(f.state.detail.id).toBe("lead-2");
  expect(f.state.note).toBe("second customer");
});

test("reopening the same customer invalidates the previous note completion", async () => {
  const f = fixture();
  const pending = f.run();
  f.requestRef.current += 1;
  f.state.note = "new session note";
  f.release();
  await pending;
  expect(f.state.note).toBe("new session note");
  expect(f.state.detail.activities).toEqual([]);
});
