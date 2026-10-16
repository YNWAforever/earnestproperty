import { createElement, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import type { VideosFixtureData } from "./data";

let loaderData: VideosFixtureData;
export function setLoaderData(value: VideosFixtureData) {
  loaderData = value;
}

type Search = {
  sort: "newest" | "oldest" | "featured";
  q?: string;
  estate?: string;
  category?: string;
};

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

function readSearch(raw = location.search): Search {
  return { sort: "newest", ...Object.fromEntries(new URLSearchParams(raw)) } as Search;
}

function useSearch() {
  const raw = useSyncExternalStore(subscribe, () => location.search);
  return useMemo(() => readSearch(raw), [raw]);
}

const navigate = async ({
  search,
}: {
  search: Search | ((previous: Search) => Search);
  replace?: boolean;
}) => {
  const next = typeof search === "function" ? search(readSearch()) : search;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && !(key === "sort" && value === "newest")) {
      query.set(key, value);
    }
  }
  window.history.replaceState({}, "", `${location.pathname}${query.size ? `?${query}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export function useNavigate(_options?: unknown) {
  return navigate;
}

// Keep the exported Route.options.component and its loader intact. The fixture
// substitutes only router state, without importing the app route tree or auth.
export function createFileRoute(_path: string) {
  return <T extends object>(options: T) => ({
    options,
    useLoaderData: () => loaderData,
    useSearch,
  });
}

export function stripSearchParams(_defaults: unknown) {
  return ({ next }: { next: () => unknown }) => next();
}

export function Link({
  to,
  params,
  search: _search,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  to: string;
  params?: Record<string, string>;
  search?: unknown;
}) {
  const href = to.replace(/\$(\w+)/g, (_match, key: string) =>
    encodeURIComponent(params?.[key] ?? ""),
  );
  return createElement("a", { ...props, href });
}
