import { createFileRoute } from "@tanstack/react-router";
import { AuthView } from "@neondatabase/auth-ui";

export const Route = createFileRoute("/auth/$pathname")({
  component: Auth,
});

function Auth() {
  const { pathname } = Route.useParams();

  return (
    <section className="flex min-h-[calc(100vh-12rem)] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <AuthView pathname={pathname} />
      </div>
    </section>
  );
}
