export function canonicalUrl(value) {
  if (!value) return "";
  // Links copied from Markdown commonly escape underscores as `\_`.
  // Treat that presentation escape as the original URL character before
  // parsing, otherwise URL() turns `/sf\_item/` into `/sf/_item/` and the
  // persisted Alibaba high-water mark can never match a real detail URL.
  const normalizedValue = String(value).replaceAll("\\_", "_");
  const url = new URL(normalizedValue, "https://pmsearch.jd.com/");
  const jd = url.href.match(/https?:\/\/paimai\.jd\.com\/(\d+)/i);
  if (jd) return `https://paimai.jd.com/${jd[1]}`;
  const ali = url.href.match(/https?:\/\/(?:sf-item|m)\.taobao\.com\/sf_item\/(\d+)(?:\.htm)?/i);
  if (ali) return `https://sf-item.taobao.com/sf_item/${ali[1]}.htm`;
  const aliSusong = url.href.match(/https?:\/\/susong-item\.taobao\.com\/auction\/(\d+)(?:\.htm)?/i);
  if (aliSusong) return `https://sf-item.taobao.com/sf_item/${aliSusong[1]}.htm`;
  url.search = "";
  url.hash = "";
  return url.href;
}
