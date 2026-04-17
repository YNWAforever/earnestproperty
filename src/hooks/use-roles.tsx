import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

export function useRoles(userId: string | undefined) {
  const [roles, setRoles] = useState<Role[] | null>(null);

  useEffect(() => {
    if (!userId) {
      setRoles(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (cancelled) return;
        setRoles((data ?? []).map((r) => r.role as Role));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    roles,
    isAdmin: roles?.includes("admin") ?? false,
    isManager: roles?.includes("manager") ?? false,
    loading: roles === null && !!userId,
  };
}
