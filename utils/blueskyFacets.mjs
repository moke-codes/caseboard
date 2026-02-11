function asRecord(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildByteToCodeUnitMap(text) {
  const encoder = new TextEncoder();
  const map = [0];
  let byteOffset = 0;
  let codeUnitOffset = 0;

  for (const char of text) {
    const bytes = encoder.encode(char);
    byteOffset += bytes.length;
    codeUnitOffset += char.length;
    map[byteOffset] = codeUnitOffset;
  }

  return map;
}

function byteOffsetToCodeUnitIndex(map, byteOffset) {
  if (byteOffset <= 0) return 0;
  if (byteOffset >= map.length) return map[map.length - 1] ?? 0;

  for (let index = byteOffset; index >= 0; index -= 1) {
    const mapped = map[index];
    if (typeof mapped === "number") return mapped;
  }
  return 0;
}

/**
 * Extract link ranges from Bluesky facets using UTF-8 byte offsets.
 * @param {Record<string, unknown>} record
 * @param {string} text
 * @returns {{start:number,end:number,url:string}[]}
 */
export function extractTextLinksFromRecord(record, text) {
  const facets = Array.isArray(record?.facets) ? record.facets : [];
  if (!facets.length) return [];

  const byteMap = buildByteToCodeUnitMap(text);
  const links = [];

  for (const facetItem of facets) {
    const facet = asRecord(facetItem);
    if (!facet) continue;
    const index = asRecord(facet.index);
    const features = Array.isArray(facet.features) ? facet.features : [];
    if (!index || !features.length) continue;

    const byteStart = asNumber(index.byteStart);
    const byteEnd = asNumber(index.byteEnd);
    if (byteStart === undefined || byteEnd === undefined || byteEnd <= byteStart) continue;

    for (const featureItem of features) {
      const feature = asRecord(featureItem);
      if (!feature) continue;
      const type = asString(feature.$type) ?? "";
      if (!type.includes("#link")) continue;
      const uri = asString(feature.uri);
      if (!uri) continue;

      const start = byteOffsetToCodeUnitIndex(byteMap, byteStart);
      const end = byteOffsetToCodeUnitIndex(byteMap, byteEnd);
      if (end <= start) continue;
      links.push({ start, end, url: uri });
    }
  }

  links.sort((a, b) => a.start - b.start || a.end - b.end);
  return links;
}
