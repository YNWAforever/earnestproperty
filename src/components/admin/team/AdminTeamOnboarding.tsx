import type { TeamOnboarding } from "@/lib/neon/team-onboarding-policy";

const labels: Record<keyof TeamOnboarding["steps"], string> = {
  staffActive: "職員記錄已啟用",
  invitation: "人工分享註冊連結",
  emailVerified: "登入電郵已驗證",
  identityBound: "登入身份已連結",
  roleBranch: "角色與分行",
  inboxAssignment: "Inbox 分派映射",
  inboxPrivateNote: "Inbox 私人備註",
  staffPhone: "同事 WhatsApp 手機路線",
};
const states = {
  ready: "已就緒",
  blocked: "需處理",
  attention: "需跟進",
  unknown: "未核實",
  not_required: "非必需",
};
const reasons: Record<string, string> = {
  EMAIL_MISSING: "職員記錄缺少電郵",
  EMAIL_UNVERIFIED: "登入電郵尚未驗證",
  EMAIL_VERIFICATION_UNKNOWN: "登入電郵驗證狀態未能核實",
  ACCOUNT_UNREGISTERED: "成員尚未註冊登入帳戶",
  IDENTITY_UNBOUND: "登入身份未連結職員記錄",
  INVITATION_EXPIRED: "邀請已過期",
  INVITATION_FAILED: "邀請未完成",
  INVITATION_MANUAL_SHARE: "請人工分享註冊連結",
  ROLE_MISSING: "沒有角色",
  AGENT_BRANCH_MISSING: "經紀未設定分行",
  INBOX_MAPPING_BLOCKED: "Inbox 分派映射未就緒",
  INBOX_READINESS_UNKNOWN: "未能核實 Inbox 分派映射",
  STAFF_PHONE_ROUTE_BLOCKED: "已配置手機路線但未就緒",
};

export function AdminTeamOnboarding({ value }: { value: TeamOnboarding }) {
  return (
    <section aria-label="首次登入及通知準備" className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold">首次登入及通知準備</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {(Object.keys(labels) as Array<keyof TeamOnboarding["steps"]>).map((key) => (
          <div key={key} className="flex justify-between gap-2 rounded border px-3 py-2">
            <dt>{labels[key]}</dt>
            <dd className="shrink-0 font-medium">{states[value.steps[key]]}</dd>
          </div>
        ))}
      </dl>
      {value.attentionReasons.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {value.attentionReasons.map((reason) => (
            <li key={reason}>{reasons[reason] ?? reason}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm">目前沒有必需的跟進項目。</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Inbox 分派、私人備註與手機收件分開核實；手機路線非所有角色必需，provider 接受不代表送達。
      </p>
    </section>
  );
}
