/**
 * Converts an AT URI post reference to the public bsky.app URL.
 * @param {{ uri?: string, authorHandle?: string }} post
 * @returns {string | null}
 */
export function postUriToWebUrl(post) {
  if (!post?.uri || !post?.authorHandle) return null;
  const normalizedUri = post.uri.split("#")[0];
  const match = normalizedUri.match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/?#]+)$/);
  if (!match) return null;
  return `https://bsky.app/profile/${post.authorHandle}/post/${match[1]}`;
}

/**
 * Escapes text for safe HTML rendering.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Converts URLs in text to clickable links while preserving trailing punctuation.
 * @param {string} value
 * @returns {string}
 */
export function linkifyPostText(value) {
  const escaped = escapeHtml(value);
  const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;
  return escaped.replace(urlPattern, (rawUrl) => {
    const match = rawUrl.match(/^(.*?)([.,!?;:)\]]*)$/);
    const coreUrl = match?.[1] ?? rawUrl;
    const trailing = match?.[2] ?? "";
    const href = coreUrl.startsWith("http://") || coreUrl.startsWith("https://") ? coreUrl : `https://${coreUrl}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${coreUrl}</a>${trailing}`;
  });
}
