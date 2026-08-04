import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  children,
  disabled,
  isPending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  children?: ReactNode;
  disabled?: boolean;
  isPending?: boolean;
  /** Failure reason shown inside the dialog. Without this the error surfaced
   * behind the modal overlay, so staff saw the action fail with no stated cause. */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isDisabled = disabled || isPending;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Only an in-flight request blocks dismissal. Previously any `disabled`
        // state (e.g. an unmet precondition) also locked the dialog shut, so a
        // staff member could be stuck in a modal they could not cancel.
        if (isPending && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children ? <div className="space-y-3">{children}</div> : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <Button
            disabled={isDisabled}
            onClick={onConfirm}
            type="button"
            variant={confirmVariant}
            aria-busy={isPending ? true : undefined}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                處理中…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
