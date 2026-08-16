function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
}

function firstPathSegment(pathname, prefix) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === prefix && parts[1]?.trim() ? parts[1] : null;
}

export function getYouTubeVideoId(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (!isYouTubeHost(host)) return null;

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (url.pathname.startsWith("/embed/")) return firstPathSegment(url.pathname, "embed");
    if (url.pathname.startsWith("/shorts/")) return firstPathSegment(url.pathname, "shorts");

    const videoId = url.searchParams.get("v")?.trim();
    return videoId || null;
  } catch {
    return null;
  }
}

export function isYouTubeVideoUrl(value) {
  return getYouTubeVideoId(value) !== null;
}

export function getYouTubeEmbedUrl(value) {
  const videoId = getYouTubeVideoId(value);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}
