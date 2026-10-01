import { actor } from "./synthetic-api";

// No JWT, Neon Auth or production adapter is exercised by this browser layer.
const user = actor === "guest" ? null : { id: actor, email: `${actor}@synthetic.invalid` };
const state = { user, session: user ? { user } : null, loading: false, signOut: async () => {} };
export const useNeonAuth = () => state;
export const withStaffAuthHeaders = async <T>(value: T) => value;
