import { FUJIAN_AREAS } from "../core/constants.mjs";
import { normalizePropertyTitleText } from "../core/title.mjs";

const FUJIAN_CITY_PREFIXES = Object.keys(FUJIAN_AREAS).sort(
  (left, right) => right.length - left.length,
);
const FUJIAN_AREA_PREFIXES = Object.values(FUJIAN_AREAS)
  .flat()
  .sort((left, right) => right.length - left.length);

export function cleanAuctionTitle(value) {
  return String(value || "")
    .replace(
      /^\s*(?:【\s*)?(?:一拍|二拍|三拍|再次拍卖|变卖|第一次拍卖|第二次拍卖|第三次拍卖)(?:\s*】)?\s*/u,
      "",
    )
    .trim();
}

function shouldKeepParenthetical(content) {
  const detail = String(content || "").trim();
  if (!detail) return false;
  if (/(?:不动产权证|房权证|国用证|产权证|权证号)/u.test(detail)) return false;
  if (/^(?:门牌号|地址为|坐落为)/u.test(detail)) return false;
  if (/^(?:原|现|原址|现址|原地址|现地址)/u.test(detail)) {
    // 原、现地址中的道路方位、地块和单位宿舍说明可以删除；项目别名仍保留。
    if (/(?:路|街|巷|弄|门牌|交叉|东侧|西侧|南侧|北侧|地块|公司宿舍)/u.test(detail)) {
      return false;
    }
  }
  // 安全策略：不确定的括号默认保留，避免再次把小区、楼栋或房号删掉。
  return true;
}

function preserveMeaningfulParentheses(value) {
  const source = String(value || "");
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source[index] !== "（" && source[index] !== "(") {
      output += source[index];
      index += 1;
      continue;
    }
    const start = index;
    let depth = 0;
    let end = -1;
    for (; index < source.length; index += 1) {
      if (source[index] === "（" || source[index] === "(") depth += 1;
      else if (source[index] === "）" || source[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) {
      output += source.slice(start);
      break;
    }
    const content = source.slice(start + 1, end).trim();
    if (shouldKeepParenthetical(content)) output += `（${content}）`;
    index = end + 1;
  }
  return output;
}

export function cleanPropertyTitle(value) {
  let title = preserveMeaningfulParentheses(normalizePropertyTitleText(cleanAuctionTitle(value)))
    .replace(/^(?:拍卖|变卖)?标的(?:物)?\s*[：:]\s*/u, "")
    .replace(/【[^】]*(?:不动产权证|房权证|国用证|产权证)[^】]*】(?:及增建扩建部分)?/gu, "")
    .replace(/\[[^\]]*(?:不动产权证|房权证|国用证|产权证)[^\]]*\](?:及增建扩建部分)?/gu, "")
    .replace(
      /^.*?(?:有限责任公司|股份有限公司|有限公司|公司|企业|厂)名下(?:的)?(?:坐落于|位于)?/u,
      "",
    )
    .replace(/^(?:名下(?:的)?|坐落于|位于)/u, "")
    .replace(/^福建省/u, "")
    .trim();
  for (const prefix of FUJIAN_CITY_PREFIXES) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }
  for (const prefix of FUJIAN_AREA_PREFIXES) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }
  title = normalizePropertyTitleText(
    title
      .replace(/^(?:名下(?:的)?|坐落于|位于)/u, "")
      .replace(/\s{2,}/gu, " ")
      .replace(/^[，,、；;：:\s]+|[，,、；;：:\s]+$/gu, "")
      .trim(),
  );
  return title || normalizePropertyTitleText(cleanAuctionTitle(value));
}
