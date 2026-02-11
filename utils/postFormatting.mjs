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
  return linkifyPostTextWithLinks(value, []);
}

/**
 * Converts post text into safe HTML with clickable links.
 * If `textLinks` are provided (from Bluesky facets), their URL is used for href.
 * @param {string} value
 * @param {{start:number,end:number,url:string}[]} textLinks
 * @returns {string}
 */
export function linkifyPostTextWithLinks(value, textLinks) {
  const links = Array.isArray(textLinks)
    ? textLinks
        .filter((item) => item && Number.isFinite(item.start) && Number.isFinite(item.end) && typeof item.url === "string")
        .map((item) => ({ start: Number(item.start), end: Number(item.end), url: item.url }))
        .sort((a, b) => a.start - b.start || a.end - b.end)
    : [];

  if (!links.length) {
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

  let html = "";
  let cursor = 0;
  for (const link of links) {
    if (link.start < cursor || link.end <= link.start || link.start >= value.length) continue;
    const clampedEnd = Math.min(value.length, link.end);
    const plainChunk = value.slice(cursor, link.start);
    const linkText = value.slice(link.start, clampedEnd);
    html += escapeHtml(plainChunk);
    html += `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>`;
    cursor = clampedEnd;
  }
  html += escapeHtml(value.slice(cursor));
  return html;
}
