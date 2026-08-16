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
      {/* The scroll container is the children wrapper, not SheetContent: when
          the whole column scrolled, the footer's 儲存 / 標記成交 buttons scrolled
          away with it, so on a lead with a long AI section and activity history
          the save controls were unreachable without scrolling back down. The
          footer now stays pinned to the bottom of the panel. */}
      <SheetContent className="flex w-full flex-col gap-4 overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <SheetFooter className="shrink-0 border-t bg-background pt-4">{footer}</SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
