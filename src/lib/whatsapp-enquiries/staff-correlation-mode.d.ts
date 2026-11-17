export type StaffCorrelationMode = "strict" | "member_id";
export declare const STAFF_CORRELATION_STRICT: "strict";
export declare const STAFF_CORRELATION_MEMBER_ID: "member_id";
export declare const STAFF_CORRELATION_MODES: readonly StaffCorrelationMode[];
export declare function staffCorrelationMode(env?: NodeJS.ProcessEnv): StaffCorrelationMode;
export declare function staffCorrelationPlan(env?: NodeJS.ProcessEnv): {
  readonly mode: StaffCorrelationMode;
  readonly verificationRef: string | null;
  readonly replyContextPath: string | null;
  readonly requiresReplyContext: boolean;
  readonly replyContextAvailable: boolean;
  readonly ready: boolean;
};
