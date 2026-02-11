import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, linkifyPostText, linkifyPostTextWithLinks, postUriToWebUrl } from "../utils/postFormatting.mjs";

test("escapeHtml escapes reserved characters", () => {
  const input = `<tag attr="x">Tom & Jerry's</tag>`;
  const output = escapeHtml(input);
  assert.equal(output, "&lt;tag attr=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/tag&gt;");
});

test("linkifyPostText creates anchor tags for protocol-less and https urls", () => {
  const input = "Read n.pr/4qyVgAO and https://bsky.app";
  const output = linkifyPostText(input);
  assert.match(output, /href="https:\/\/n\.pr\/4qyVgAO"/);
  assert.match(output, /href="https:\/\/bsky\.app"/);
});

test("linkifyPostText keeps trailing punctuation outside links", () => {
  const output = linkifyPostText("See https://example.com/path, now.");
  assert.match(output, /<a href="https:\/\/example\.com\/path"[^>]*>https:\/\/example\.com\/path<\/a>, now\./);
});

test("postUriToWebUrl maps at-uri to profile post url", () => {
  const url = postUriToWebUrl({
    uri: "at://did:plc:abc123/app.bsky.feed.post/3mekxi662442c",
    authorHandle: "npr.org",
  });
  assert.equal(url, "https://bsky.app/profile/npr.org/post/3mekxi662442c");
});

test("postUriToWebUrl returns null for invalid or missing inputs", () => {
  assert.equal(postUriToWebUrl({ uri: "", authorHandle: "npr.org" }), null);
  assert.equal(postUriToWebUrl({ uri: "at://did/app.bsky.feed.like/xyz", authorHandle: "npr.org" }), null);
});

test("linkifyPostTextWithLinks keeps shortened display text while using full href", () => {
  const text = "Read www.test.com/... for details";
  const html = linkifyPostTextWithLinks(text, [
    {
      start: 5,
      end: 21,
      url: "https://www.test.com/mytest",
    },
  ]);
  assert.match(html, /href="https:\/\/www\.test\.com\/mytest"/);
  assert.match(html, />www\.test\.com\/\.\.\.<\/a>/);
});
