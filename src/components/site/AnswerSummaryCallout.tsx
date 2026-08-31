/**
 * P7e: extracted verbatim from blog_.$slug.tsx's original inline "重點摘要"
 * block (same classes, same structure) -- now reused by estate/district/
 * corridor pages too, past the point where copy-pasting this 3-line block
 * per route is cheaper than one shared component. Renders nothing for an
 * empty/undefined summary, matching every other optional-content section
 * in this codebase's hide-don't-placeholder convention.
 */
export function AnswerSummaryCallout({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;

  return (
    <div className="mt-8 rounded-md border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-primary">重點摘要</p>
      <p className="mt-1 text-sm leading-7 text-foreground">{summary}</p>
    </div>
  );
}
