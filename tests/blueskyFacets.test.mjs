import test from "node:test";
import assert from "node:assert/strict";
import { extractTextLinksFromRecord } from "../utils/blueskyFacets.mjs";

function byteRangeFor(text, snippet) {
  const startCodeUnit = text.indexOf(snippet);
  if (startCodeUnit < 0) throw new Error("snippet not found");
  const endCodeUnit = startCodeUnit + snippet.length;
  const encoder = new TextEncoder();
  const startBytes = encoder.encode(text.slice(0, startCodeUnit)).length;
  const endBytes = encoder.encode(text.slice(0, endCodeUnit)).length;
  return { startBytes, endBytes, startCodeUnit, endCodeUnit };
}

test("extractTextLinksFromRecord parses basic link facet", () => {
  const text = "Check www.test.com/... now";
  const range = byteRangeFor(text, "www.test.com/...");
  const record = {
    facets: [
      {
        index: { byteStart: range.startBytes, byteEnd: range.endBytes },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://www.test.com/mytest" }],
      },
    ],
  };

  const links = extractTextLinksFromRecord(record, text);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0], {
    start: range.startCodeUnit,
    end: range.endCodeUnit,
    url: "https://www.test.com/mytest",
  });
});

test("extractTextLinksFromRecord handles utf-8 offsets with emoji", () => {
  const text = "😀 Visit n.pr/4qyVgAO now";
  const range = byteRangeFor(text, "n.pr/4qyVgAO");
  const record = {
    facets: [
      {
        index: { byteStart: range.startBytes, byteEnd: range.endBytes },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://n.pr/4qyVgAO" }],
      },
    ],
  };

  const links = extractTextLinksFromRecord(record, text);
  assert.equal(links.length, 1);
  assert.equal(text.slice(links[0].start, links[0].end), "n.pr/4qyVgAO");
  assert.equal(links[0].url, "https://n.pr/4qyVgAO");
});

test("extractTextLinksFromRecord ignores invalid or non-link facets", () => {
  const text = "hello world";
  const record = {
    facets: [
      { index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:x" }] },
      { index: { byteStart: 8, byteEnd: 2 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://x.test" }] },
      { index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: "app.bsky.richtext.facet#link" }] },
    ],
  };

  const links = extractTextLinksFromRecord(record, text);
  assert.deepEqual(links, []);
});

test("extractTextLinksFromRecord returns links sorted by range", () => {
  const text = "a.test and b.test";
  const a = byteRangeFor(text, "a.test");
  const b = byteRangeFor(text, "b.test");
  const record = {
    facets: [
      {
        index: { byteStart: b.startBytes, byteEnd: b.endBytes },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://b.test" }],
      },
      {
        index: { byteStart: a.startBytes, byteEnd: a.endBytes },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://a.test" }],
      },
    ],
  };

  const links = extractTextLinksFromRecord(record, text);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://a.test");
  assert.equal(links[1].url, "https://b.test");
});
