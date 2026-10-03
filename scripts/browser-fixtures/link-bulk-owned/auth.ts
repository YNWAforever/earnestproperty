const actor = sessionStorage.getItem("owned-link-bulk-actor") ?? "owned-bulk-manager-a";
const user = { id: actor, email: `${actor}@synthetic.invalid` };
const state = { user, session: { user }, loading: false, signOut: async () => {} };
export const useNeonAuth = () => state;
export const withStaffAuthHeaders = async <T>(value: T) => value;
