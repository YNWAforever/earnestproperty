const BLOB_API_URL = "https://vercel.com/api/blob/";

function requiredTrimmedString(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty trimmed string`);
  }
  return value;
}

function bodySize(body) {
  if (body == null) throw new TypeError("body is required");
  if (typeof body.size === "number") return body.size;
  if (typeof body.byteLength === "number") return body.byteLength;
  throw new TypeError("body must expose a finite byte size");
}

function finiteSize(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function httpsUrl(value, name) {
  const text = requiredTrimmedString(value, name);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError(`${name} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError(`${name} is invalid`);
  }
  return url.toString();
}

function parseBlobMetadata(value, requested) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vercel Blob upload returned invalid metadata");
  }
  let url;
  let downloadUrl;
  try {
    url = httpsUrl(value.url, "Vercel Blob url");
    downloadUrl = value.downloadUrl == null ? url : httpsUrl(value.downloadUrl, "downloadUrl");
  } catch {
    throw new Error("Vercel Blob upload returned invalid metadata");
  }
  if (value.pathname !== requested.pathname) {
    throw new Error("Vercel Blob upload returned invalid metadata");
  }
  const contentType = value.contentType == null ? requested.contentType : value.contentType;
  if (
    typeof contentType !== "string" ||
    contentType.length === 0 ||
    contentType.trim() !== contentType
  ) {
    throw new Error("Vercel Blob upload returned invalid metadata");
  }
  const size = value.size == null ? requested.size : value.size;
  try {
    finiteSize(size, "Vercel Blob size");
  } catch {
    throw new Error("Vercel Blob upload returned invalid metadata");
  }
  return Object.freeze({
    url,
    downloadUrl,
    pathname: requested.pathname,
    contentType,
    size,
  });
}

export function createVercelBlobStore({ token, fetchImpl = globalThis.fetch } = {}) {
  const validatedToken = requiredTrimmedString(token, "Vercel Blob token");
  const storeId = validatedToken.split("_")[3];
  if (!storeId) throw new TypeError("Vercel Blob token is invalid");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  return Object.freeze({
    async put({ pathname, body, contentType } = {}) {
      const requestedPathname = requiredTrimmedString(pathname, "pathname");
      if (requestedPathname.includes("\0")) throw new TypeError("pathname is invalid");
      const requestedContentType = requiredTrimmedString(contentType, "contentType");
      const size = finiteSize(bodySize(body), "body size");
      const params = new URLSearchParams({ pathname: requestedPathname });
      const response = await fetchImpl(`${BLOB_API_URL}?${params.toString()}`, {
        method: "PUT",
        redirect: "error",
        headers: {
          authorization: `Bearer ${validatedToken}`,
          "x-api-version": "12",
          "x-vercel-blob-store-id": storeId,
          "x-vercel-blob-access": "public",
          "x-content-type": requestedContentType,
        },
        body,
      });
      if (!response?.ok) {
        const status = Number.isInteger(response?.status) ? response.status : "unknown";
        throw new Error(`Vercel Blob upload failed: ${status}`);
      }
      let metadata;
      try {
        metadata = await response.json();
      } catch {
        throw new Error("Vercel Blob upload returned invalid metadata");
      }
      return parseBlobMetadata(metadata, {
        pathname: requestedPathname,
        contentType: requestedContentType,
        size,
      });
    },
  });
}
