import { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function AdminDetailPanel({
  open,
  title,
  description,
  children,
  footer,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">{children}</div>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
