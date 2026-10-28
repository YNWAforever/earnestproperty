import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FaqLike } from "@/lib/faq";

/** Native disclosures keep answers in server HTML and work before hydration. */
export function FaqList({
  items,
  group,
  className,
  questionClassName,
}: {
  items: readonly FaqLike[];
  group: string;
  className?: string;
  questionClassName?: string;
}) {
  return (
    <div className={className}>
      {items.map((item, index) => (
        <details key={`${item.question}-${index}`} name={group} className="group border-b">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-sm font-medium transition-colors hover:underline [&::-webkit-details-marker]:hidden",
              questionClassName,
            )}
          >
            <span>{item.question}</span>
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
