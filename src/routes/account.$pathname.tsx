import { createFileRoute } from "@tanstack/react-router";
import { AccountView } from "@neondatabase/auth-ui";

export const Route = createFileRoute("/account/$pathname")({
  // Account settings are per-user: give the tab a name and keep the page out
  // of the index (robots.txt already disallows /account; this covers a
  // crawler that arrives via a shared link).
  head: () => ({
    meta: [{ title: "帳戶設定｜晉誠地產" }, { name: "robots", content: "noindex" }],
  }),
  component: Account,
});

function Account() {
  const { pathname } = Route.useParams();

  return (
    <section className="flex min-h-[calc(100vh-12rem)] items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-3xl">
        <AccountView pathname={pathname} />
      </div>
    </section>
  );
}
