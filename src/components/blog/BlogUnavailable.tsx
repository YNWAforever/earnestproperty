import { Link, useRouter } from "@tanstack/react-router";

export function BlogNotFound() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">找不到文章或分類</h1>
      <Link to="/blog" className="mt-4 inline-block text-primary underline">
        返回 Blog
      </Link>
    </div>
  );
}

export function BlogUnavailable() {
  const router = useRouter();
  return (
    <div role="alert" className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">文章暫時未能載入</h1>
      <button
        type="button"
        className="mt-4 text-primary underline"
        onClick={() => void router.invalidate()}
      >
        重試
      </button>
    </div>
  );
}
