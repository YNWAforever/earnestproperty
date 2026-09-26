import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { AccountView } from "@neondatabase/auth-ui";

export const Route = createFileRoute("/account/$pathname")({
  // Account settings are per-user: give the tab a name and keep the page out
  // of the index (robots.txt already disallows /account; this covers a
  // crawler that arrives via a shared link).
  head: () => ({
    // Without its own description this inherited the homepage description and
    // the homepage og/twitter card from the root shell, so a shared account
    // link unfurled as the public site's marketing copy.
    meta: [
      { title: "帳戶設定｜晉誠地產職員系統" },
      {
        name: "description",
        content:
          "晉誠地產職員帳戶設定：管理登入電郵、密碼及個人資料。此頁只供已登入職員使用，不對外公開，亦不會被搜尋引擎收錄。",
      },
      { property: "og:title", content: "帳戶設定｜晉誠地產職員系統" },
      { property: "og:description", content: "晉誠地產職員帳戶設定頁，只供已登入職員使用。" },
      { name: "twitter:title", content: "帳戶設定｜晉誠地產職員系統" },
      { name: "twitter:description", content: "晉誠地產職員帳戶設定頁，只供已登入職員使用。" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Account,
});

function Account() {
  const { pathname } = Route.useParams();

  return (
    <section className="flex min-h-[calc(100vh-12rem)] items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-3xl">
        <ClientOnly
          fallback={
            <p role="status" aria-busy="true">
              正在載入帳戶設定…
            </p>
          }
        >
          <AccountView pathname={pathname} />
        </ClientOnly>
      </div>
    </section>
  );
}
