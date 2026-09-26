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
    const webProtocol = url.protocol === "https:" || url.protocol === "http:";
    if (!webProtocol || !isYouTubeHost(host)) return null;

    let videoId;
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0];
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = firstPathSegment(url.pathname, "embed");
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = firstPathSegment(url.pathname, "shorts");
    } else {
      videoId = url.searchParams.get("v")?.trim();
    }

    // Only a decoded, path-safe token may enter iframe and thumbnail URLs.
    const normalizedId = decodeURIComponent(videoId ?? "");
    return /^[A-Za-z0-9_-]+$/.test(normalizedId) ? normalizedId : null;
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

/**
 * Poster frame for a video, used to render a facade in place of a live embed.
 *
 * hqdefault is the one thumbnail YouTube generates for every upload; maxresdefault
 * only exists for videos uploaded above 720p and 404s silently for the rest,
 * which would leave holes in the grid.
 */
export function getYouTubeThumbnailUrl(value) {
  const videoId = getYouTubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}
