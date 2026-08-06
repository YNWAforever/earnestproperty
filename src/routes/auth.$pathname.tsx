import { createFileRoute } from "@tanstack/react-router";
import { AuthView } from "@neondatabase/auth-ui";

import { safeAdminRedirect } from "@/lib/admin/safe-redirect";

export const Route = createFileRoute("/auth/$pathname")({
  // `redirect` carries the admin page the user originally asked for. Without it
  // a deep link to /admin/whatsapp sent staff here and then to the public
  // homepage, leaving them to navigate back by hand.
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: Auth,
});

function Auth() {
  const { pathname } = Route.useParams();
  const { redirect } = Route.useSearch();
  // Validated, not trusted: the parameter is attacker-controllable, so it is
  // run through an allowlist rather than passed straight to AuthView.
  const redirectTo = safeAdminRedirect(redirect);

  return (
    <section className="flex min-h-[calc(100vh-12rem)] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <AuthView pathname={pathname} redirectTo={redirectTo} />
      </div>
    </section>
  );
}
