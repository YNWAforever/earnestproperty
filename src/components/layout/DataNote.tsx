import * as React from "react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface DataNoteProps
  extends React.HTMLAttributes<HTMLDivElement>, DataAttributes {
  source: React.ReactNode;
  sourceUrl?: string;
  asOf?: React.ReactNode;
  caveat?: React.ReactNode;
}

const DataNote = React.forwardRef<HTMLDivElement, DataNoteProps>(
  ({ className, source, sourceUrl, asOf, caveat, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground",
        className,
      )}
      {...props}
    >
      <p>
        資料來源：
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {source}
          </a>
        ) : (
          source
        )}
        {asOf ? <> ・ 更新於 {asOf}</> : null}
      </p>
      {caveat ? <p className="mt-1">{caveat}</p> : null}
    </div>
  ),
);
DataNote.displayName = "DataNote";

export { DataNote };
