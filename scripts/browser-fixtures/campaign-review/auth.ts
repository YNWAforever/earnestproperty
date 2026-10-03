import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let auth = {
  user: {
    id: sessionStorage.getItem("campaign-review-actor") ?? "actor-a",
    email: "owned@synthetic.invalid",
  },
  loading: false,
  signOut: async () => {},
};
export function changeActor(id: string) {
  auth = { ...auth, user: { ...auth.user, id } };
  sessionStorage.setItem("campaign-review-actor", id);
  for (const listener of listeners) listener();
}
export const useNeonAuth = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => auth,
    () => auth,
  );
export const withStaffAuthHeaders = async <T>(value: T) => value;
