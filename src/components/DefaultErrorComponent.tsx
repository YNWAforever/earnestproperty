import { Link, useRouter } from "@tanstack/react-router";

/** Router-level fallback for an unhandled render/loader error.
 *
 * Lives here rather than in router.tsx so that file exports only the router
 * factory (react-refresh/only-export-components).
 *
 * zh-HK copy (this was the scaffold's English "Something went wrong") and
 * page-sized rather than `min-h-screen`, which added a viewport of empty
 * space under the sticky header.
 */

export function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
          頁面暫時未能顯示
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          載入時遇到未預期的問題。請再試一次；如果問題持續，可返回首頁或直接 WhatsApp 我們。
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            再試一次
          </button>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            返回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
