/**
 * Only an admin or a manager may verify or publish a transaction, or edit one
 * that has been verified or published (FX-18a B-04). An agent works on their own
 * unverified deals and asks a manager for the rest.
 */
export function canVerifyTransactions(roles: readonly string[]): boolean {
  return roles.includes("admin") || roles.includes("manager");
}
