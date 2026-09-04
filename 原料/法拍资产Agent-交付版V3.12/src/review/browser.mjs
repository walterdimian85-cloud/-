import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sleep } from "../utils.mjs";

export function isVerificationPage(url, text) {
  const normalizedUrl = String(url || "");
  const sample = String(text || "").slice(0, 12000);
  if (/login|captcha|punish|sec\.taobao|passport\.jd|safe\.jd/iu.test(normalizedUrl)) return true;
  if (/验证码|滑块验证|请拖动滑块|安全验证|短信验证|访问过于频繁|完成验证后继续/iu.test(sample)) return true;

  // 京东正常详情页会常驻“您当前未登录，请登录后参拍”的账户提示；
  // 页面已有拍卖字段时，该提示不能被当成整页登录拦截。
  const hasAuctionContent =
    /起拍价|成交价|市场价|保证金|竞价信息|拍卖标的|标的物详情|预告中|已成交|已流拍/iu.test(sample);
  if (/请登录|账号登录|用户登录/iu.test(sample) && !hasAuctionContent) return true;
  return false;
}

async function edgeExecutable() {
  const candidates = process.platform === "win32" ? [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ] : [];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  return undefined;
}

export async function createEvidenceBrowser(config, onUserAction = async () => {}) {
  const runtimeUrl = pathToFileURL(path.join(config.skillV2Dir, "scripts", "runtime.mjs")).href;
  const { loadPlaywright } = await import(runtimeUrl);
  const { chromium } = await loadPlaywright();
  const profileDir = config.profileDir || path.join(config.stateDir, "edge-profile");
  const launch = async (visible = false) => chromium.launchPersistentContext(profileDir, {
    // AI复核默认真正后台运行，不创建会抢焦点的Edge窗口。只有页面明确要求
    // 人工验证时，才关闭后台上下文并重开一个可见、最小化的人工接管窗口。
    headless: !visible,
    executablePath: await edgeExecutable(),
    viewport: visible ? null : { width: 1440, height: 1000 },
    args: visible
      ? ["--start-minimized", "--no-first-run"]
      : ["--no-first-run"],
  });
  let context = await launch();
  const contextClosed = (error) => /Target page, context or browser has been closed|Browser has been closed|TargetClosedError/iu.test(String(error));
  async function captureOnce(url) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await sleep(3000);
      let text = await page.locator("body").innerText().catch(() => "");
      const verification = isVerificationPage(page.url(), text);
      if (verification) {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        context = await launch(true);
        const visiblePage = await context.newPage();
        await visiblePage.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await onUserAction({ type: "verification", url, message: "AI复核遇到登录或验证，请在Edge中人工完成" });
        const deadline = Date.now() + config.collection.userActionTimeoutMinutes * 60_000;
        while (Date.now() < deadline) {
          await sleep(3000);
          if (visiblePage.isClosed()) {
            const error = new Error("人工验证尚未完成，验证窗口已经关闭。可重新打开验证页面后继续。");
            error.code = "VERIFICATION_WINDOW_CLOSED";
            throw error;
          }
          try { text = await visiblePage.locator("body").innerText(); }
          catch (error) {
            if (contextClosed(error)) {
              const closed = new Error("人工验证尚未完成，验证窗口已经关闭。可重新打开验证页面后继续。");
              closed.code = "VERIFICATION_WINDOW_CLOSED";
              throw closed;
            }
            throw error;
          }
          if (!isVerificationPage(visiblePage.url(), text)) break;
        }
        const stillBlocked = isVerificationPage(visiblePage.url(), text);
        if (stillBlocked) {
          const error = new Error("人工验证等待超过1小时，AI复核已暂停；完成验证后可继续任务");
          error.code = "USER_ACTION_TIMEOUT";
          throw error;
        }
        const rows = await visiblePage.locator("tr").allInnerTexts().catch(() => []);
        const result = [`URL: ${visiblePage.url()}`, text, "表格行：", ...rows].join("\n").slice(0, 120000);
        await visiblePage.close().catch(() => {});
        await context.close().catch(() => {});
        context = await launch(false);
        return result;
      }
      const rows = await page.locator("tr").allInnerTexts().catch(() => []);
      return [`URL: ${page.url()}`, text, "表格行：", ...rows].join("\n").slice(0, 120000);
    } finally { await page.close().catch(() => {}); }
  }
  return {
    async capture(url) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try { return await captureOnce(url); }
        catch (error) {
          if (!contextClosed(error) || attempt === 3) throw error;
          await context.close().catch(() => {});
          await sleep(attempt * 1500);
          context = await launch();
        }
      }
    },
    async close() { await context.close().catch(() => {}); },
  };
}
