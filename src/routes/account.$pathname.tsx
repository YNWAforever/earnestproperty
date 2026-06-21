import { createFileRoute } from "@tanstack/react-router";
import { AccountView } from "@neondatabase/auth-ui";

export const Route = createFileRoute("/account/$pathname")({
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
