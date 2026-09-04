import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  alibabaDeferredReviewItems,
  detectAlibabaOutcome,
  extractAreaByPriority,
  fieldConflictReviewItems,
  interpretJdResult,
  isAlibabaAssetTradingPage,
  isAlibabaPersonalHomeRedirectUrl,
  cleanPropertyTitle,
  missingHighWaterMarks,
  resolveRememberedOutputDir,
  restoreCheckpointRecords,
} from "../../scripts/run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(await fs.readFile(path.join(root, "tests/fixtures/special-cases.json"), "utf8"));

for (const sample of fixture.outcomes) {
  if (sample.platform === "alibaba") {
    assert.equal(detectAlibabaOutcome(sample.text), sample.expected, sample.id);
  } else {
    assert.deepEqual(interpretJdResult(sample.status, sample.amount), sample.expected, sample.id);
  }
}
for (const sample of fixture.areas) {
  const actual = extractAreaByPriority(sample.sources);
  assert.equal(actual.area, sample.expected.area, `${sample.id}: area`);
  assert.equal(actual.source, sample.expected.source, `${sample.id}: source`);
  assert.ok(actual.ruleId, `${sample.id}: ruleId`);
  assert.ok(actual.rawText || actual.area === null, `${sample.id}: raw evidence`);
}
for (const sample of fixture.scope) {
  assert.equal(
    isAlibabaAssetTradingPage({ url: () => "https://sf-item.taobao.com/sample" }, sample.text),
    sample.excluded,
  );
}
assert.equal(isAlibabaPersonalHomeRedirectUrl("https://i.taobao.com/my_itaobao"), true);
assert.equal(isAlibabaPersonalHomeRedirectUrl("https://sf.taobao.com/list/0.htm"), false);
const deferredAlibabaReviews = alibabaDeferredReviewItems([
  {
    action: "deferred-alibaba-bankruptcy-layout",
    category: "住宅用房",
    status: "即将开始",
    title: "破产拍卖测试标的",
    url: "https://sf-item.taobao.com/sf_item/1071908807183.htm?track_id=test",
    capturedAt: "2026-08-10T00:00:00.000Z",
  },
]);
assert.equal(deferredAlibabaReviews.length, 1);
assert.equal(
  deferredAlibabaReviews[0].网站链接,
  "https://sf-item.taobao.com/sf_item/1071908807183.htm",
);
assert.match(deferredAlibabaReviews[0].待复核原因, /已保留列表链接并从下一条继续/u);
for (const sample of fixture.titles) {
  assert.equal(cleanPropertyTitle(sample.input), sample.expected, sample.id);
}
const conflictReviews = fieldConflictReviewItems([{
  平台: "阿里资产",
  标的类型: "住宅",
  标的名称: "测试住宅及附属间",
  网站链接: "https://example.invalid/area-conflict",
  _状态分组: "即将开始",
  _fieldEvidence: {
    "面积/㎡": {
      reviewRequired: true,
      conflicts: [{
        type: "mixed-component-total-ambiguous",
        selectedArea: 100,
        possibleCombinedArea: 108,
        components: [100, 8],
      }],
    },
  },
}]);
assert.equal(conflictReviews.length, 1);
assert.match(conflictReviews[0].待复核原因, /当前选择100㎡.*108㎡/u);
assert.deepEqual(conflictReviews[0].待复核字段, ["面积/㎡"]);
assert.equal(missingHighWaterMarks({}, "all").length, fixture.highWater.emptyAllMissing);
const restored = { records: {} };
restoreCheckpointRecords(restored, fixture.checkpoint);
assert.equal(Object.keys(restored.records).length, fixture.checkpoint.expectedRestored);

const firstRunDir = path.join(root, "tmp", "first-run-output-test");
await fs.rm(firstRunDir, { recursive: true, force: true });
await assert.rejects(
  resolveRememberedOutputDir({
    stateDir: firstRunDir,
    outputDir: path.join(firstRunDir, "implicit"),
    outputDirProvided: false,
  }),
  /首次运行尚未设置房源结果保存目录/u,
);
const chosenOutput = path.join(firstRunDir, "chosen-results");
await resolveRememberedOutputDir({
  stateDir: firstRunDir,
  outputDir: chosenOutput,
  outputDirProvided: true,
});
const resumedOptions = {
  stateDir: firstRunDir,
  outputDir: path.join(firstRunDir, "implicit"),
  outputDirProvided: false,
};
assert.equal(await resolveRememberedOutputDir(resumedOptions), chosenOutput);
assert.equal(resumedOptions.outputDir, chosenOutput);
await fs.rm(firstRunDir, { recursive: true, force: true });

console.log("special regression cases passed");
