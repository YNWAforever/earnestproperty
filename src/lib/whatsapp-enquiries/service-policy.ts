export type ServiceRules = {
  purpose?: "full_service" | "routing_notifications";
  timezone: string | null;
  weekdays: number[] | null;
  holidays: string[] | null;
  openMinute: number | null;
  closeMinute: number | null;
  durationMode: "elapsed" | "opening" | null;
  beforeOpen: "overnight" | "daytime" | null;
  atOpen: "daytime" | "overnight" | null;
  atClose: "daytime" | "overnight" | null;
  crossClosing: "elapsed" | "opening" | null;
  reception: "excluded" | "sales" | null;
  suppressSurveyAfterHuman: boolean | null;
  freshnessSeconds: number | null;
  surveyExpirySeconds: number | null;
  workerLagSeconds: number | null;
  managerStaffId: string | null;
};
export type ServicePolicy = {
  id: string;
  version: number;
  status: "draft" | "approved" | "retired";
  approvedBy: string | null;
  effectiveAt: string | null;
  rules: ServiceRules;
  copy: { afterHours: string | null };
  copyVersion: string | null;
};
export type ServiceSchedule =
  | {
      status: "ready";
      responseDueAt: string;
      surveyDueAt: string;
      afterHours: boolean;
      expiryAt: string;
    }
  | { status: "unresolved"; reasons: string[] }
  | { status: "not_applicable"; reason: string };
export function draftServicePolicy(): ServicePolicy {
  return {
    id: "",
    version: 1,
    status: "draft",
    approvedBy: null,
    effectiveAt: null,
    copyVersion: null,
    copy: { afterHours: null },
    rules: {
      timezone: "Asia/Hong_Kong",
      weekdays: null,
      holidays: null,
      openMinute: 480,
      closeMinute: 1320,
      durationMode: null,
      beforeOpen: null,
      atOpen: null,
      atClose: null,
      crossClosing: null,
      reception: null,
      suppressSurveyAfterHuman: null,
      freshnessSeconds: null,
      surveyExpirySeconds: null,
      workerLagSeconds: null,
      managerStaffId: null,
    },
  };
}
/** Require an unambiguous real instant; Date.parse alone normalizes invalid days. */
function serviceInstant(value: string | null): number {
  if (typeof value !== "string") return NaN;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return NaN;
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) return NaN;
  const offset = match[5];
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
    return NaN;
  return Date.parse(value);
}
export function unresolvedServicePolicy(policy: ServicePolicy): string[] {
  const r = policy.rules,
    reasons: string[] = [];
  if (
    policy.status !== "approved" ||
    !policy.approvedBy ||
    !policy.copyVersion ||
    !policy.effectiveAt ||
    !Number.isFinite(serviceInstant(policy.effectiveAt))
  )
    reasons.push("POLICY_NOT_APPROVED");
  if (r.purpose === "routing_notifications") {
    if (!r.managerStaffId) reasons.push("POLICY_MISSING_managerStaffId");
    if (
      !Number.isInteger(r.freshnessSeconds) ||
      Number(r.freshnessSeconds) <= 0 ||
      Number(r.freshnessSeconds) > 366 * 86400
    )
      reasons.push("POLICY_INVALID_freshnessSeconds");
    return reasons;
  }
  for (const key of Object.keys(r) as (keyof ServiceRules)[])
    if (r[key] === null) reasons.push(`POLICY_MISSING_${key}`);
  if (
    !r.weekdays?.length ||
    r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(r.weekdays).size !== r.weekdays.length
  )
    reasons.push("POLICY_WEEKDAYS_INVALID");
  if (
    !r.holidays ||
    r.holidays.some(
      (d) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d,
    )
  )
    reasons.push("POLICY_HOLIDAYS_INVALID");
  if (
    r.openMinute === null ||
    r.closeMinute === null ||
    !Number.isInteger(r.openMinute) ||
    !Number.isInteger(r.closeMinute) ||
    r.openMinute < 0 ||
    r.closeMinute > 1440 ||
    r.closeMinute <= r.openMinute
  )
    reasons.push("POLICY_HOURS_INVALID");
  for (const key of ["freshnessSeconds", "surveyExpirySeconds", "workerLagSeconds"] as const)
    if (!Number.isInteger(r[key]) || Number(r[key]) <= 0 || Number(r[key]) > 366 * 86400)
      reasons.push(`POLICY_INVALID_${key}`);
  if (!policy.copy.afterHours?.trim()) reasons.push("AFTER_HOURS_COPY_UNAPPROVED");
  try {
    if (!r.timezone) throw Error();
    new Intl.DateTimeFormat("en", { timeZone: r.timezone }).format();
  } catch {
    reasons.push("POLICY_TIMEZONE_INVALID");
  }
  return reasons;
}
/** No browser clock/locale authority. Bounds prevent malformed calendars from unbounded work. */
export function calculateServiceSchedule(
  policy: ServicePolicy,
  intake: { occurredAt: string | null; receivedAt: string; entryPointType: "sales" | "reception" },
  now: Date,
): ServiceSchedule {
  const reasons = unresolvedServicePolicy(policy);
  if (reasons.length) return { status: "unresolved", reasons };
  if (policy.rules.purpose === "routing_notifications")
    return { status: "not_applicable", reason: "ROUTING_ONLY_POLICY" };
  const r = policy.rules,
    at = serviceInstant(intake.occurredAt),
    received = serviceInstant(intake.receivedAt),
    current = now.getTime();
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(received) ||
    !Number.isFinite(current) ||
    at > received ||
    received > current ||
    at > current ||
    current - at > Number(r.freshnessSeconds) * 1000 ||
    at < serviceInstant(policy.effectiveAt)
  )
    return { status: "unresolved", reasons: ["INTAKE_TIME_UNVERIFIED"] };
  if (intake.entryPointType === "reception" && r.reception === "excluded")
    return { status: "not_applicable", reason: "RECEPTION_EXCLUDED_BY_POLICY" };
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: r.timezone!,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const local = (time: number) => {
    const parts = Object.fromEntries(format.formatToParts(time).map((p) => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return {
      date,
      minute:
        Number(parts.hour) * 60 +
        Number(parts.minute) +
        Number(parts.second) / 60 +
        (time % 1000) / 60000,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    };
  };
  const workday = (p: ReturnType<typeof local>) =>
    r.weekdays!.includes(p.weekday) && !r.holidays!.includes(p.date);
  const opened = (time: number) => {
    const p = local(time);
    return workday(p) && p.minute >= r.openMinute! && p.minute < r.closeMinute!;
  };
  const seek = (start: number, accept: (time: number) => boolean) => {
    let t = start;
    for (let n = 0; n < 46080; n++) {
      if (accept(t)) return t;
      t += 60000 - (t % 60000);
    }
    throw new Error("CALENDAR_HORIZON_EXCEEDED");
  };
  const openingDuration = (start: number) => {
    let t = start,
      remaining = 180 * 60000;
    for (let n = 0; n < 46080; n++) {
      const step = Math.min(remaining, 60000 - (t % 60000));
      if (opened(t)) remaining -= step;
      t += step;
      if (remaining === 0) return t;
    }
    throw new Error("CALENDAR_HORIZON_EXCEEDED");
  };
  try {
    const p = local(at);
    const afterHours =
      !workday(p) ||
      (p.minute < r.openMinute! && r.beforeOpen === "overnight") ||
      (p.minute === r.openMinute && r.atOpen === "overnight") ||
      (p.minute === r.closeMinute && r.atClose === "overnight") ||
      p.minute > r.closeMinute!;
    let response: number, survey: number;
    if (afterHours) {
      const next = seek(at + (p.minute >= r.closeMinute! ? 60000 : 0), opened);
      response = r.durationMode === "opening" ? openingDuration(next) : next + 180 * 60000;
      const day = local(next).date;
      survey = seek(at + 1, (t) => {
        const d = local(t);
        return d.date >= day && workday(d) && d.minute === 600;
      });
    } else {
      const elapsed = at + 180 * 60000;
      const crosses = local(elapsed).date !== p.date || local(elapsed).minute > r.closeMinute!;
      const mode = crosses ? r.crossClosing : r.durationMode;
      response = mode === "opening" ? openingDuration(at) : elapsed;
      survey = response;
    }
    return {
      status: "ready",
      responseDueAt: new Date(response).toISOString(),
      surveyDueAt: new Date(survey).toISOString(),
      afterHours,
      expiryAt: new Date(survey + Number(r.surveyExpirySeconds) * 1000).toISOString(),
    };
  } catch {
    return { status: "unresolved", reasons: ["CALENDAR_HORIZON_EXCEEDED"] };
  }
}
