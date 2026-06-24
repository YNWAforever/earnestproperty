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
  disabled,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  disabled?: boolean;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isDisabled = disabled || isPending;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDisabled && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDisabled}>取消</AlertDialogCancel>
          <Button disabled={isDisabled} onClick={onConfirm} type="button" variant={confirmVariant}>
            {isPending ? "處理中…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
