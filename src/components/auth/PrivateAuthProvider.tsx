import type { ReactNode } from "react";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import { authClient } from "@/auth";
import { SITE_URL } from "@/content/seo";
export default function PrivateAuthProvider({ children }: { children: ReactNode }) {
  return (
    <NeonAuthUIProvider authClient={authClient} baseURL={SITE_URL} defaultTheme="light">
      {children}
    </NeonAuthUIProvider>
  );
}
