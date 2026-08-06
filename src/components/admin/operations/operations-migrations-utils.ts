/** Pure confirmation rules behind the migrations panel.
 *
 * Extracted from AdminOperationsMigrations.tsx so that file exports only
 * components (react-refresh/only-export-components).
 */

export const canConfirmMigrationApply = (migrationId: string, typedId: string) =>
  migrationId === typedId;

export const migrationPlanShouldClear = (status: number) => status === 409;
