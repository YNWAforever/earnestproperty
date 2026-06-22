import { authClient } from "@/auth";

export function useNeonAuth() {
  const session = authClient.useSession();
  return {
    loading: session.isPending,
    session: session.data?.session ?? null,
    user: session.data?.user ?? null,
    signOut: () => authClient.signOut(),
  };
}
