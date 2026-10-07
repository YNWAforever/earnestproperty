export type LiveAgentEvalStep =
  | {
      type: "message";
      text: string;
      /** Expected reply kind from the deterministic responder. */
      expectKind?: string;
      /** Expected stored reply text (the FX-03 fixed reply after a handoff). */
      expectText?: string;
    }
  | {
      type: "handoff";
      phone: string;
      expectError?: { status: number; code: string };
      /** Normalised phone of the lead's contact after this step. */
      expectContactPhone?: string;
    };

export type LiveAgentEvalCase = {
  id: number;
  label: string;
  kind: "message" | "handoff";
  input: string | { steps: LiveAgentEvalStep[] };
  expect: {
    kind?: string;
    /** Exact card hrefs, in order. */
    cards?: Array<string | null>;
    mustInclude?: string[];
    mustNotInclude?: string[];
    handoffSuggested?: boolean;
  };
  /** false for 13, 14, 15 (they write leads), so Task 5's live layer skips them. */
  live: boolean;
};

export declare const LIVE_AGENT_EVAL_CASES: LiveAgentEvalCase[];
