# WorkBuddy 运行与验证

## 首次导入

将整个`fujian-auctions`目录作为本地Skill导入，而不是只导入`adapters/workbuddy`。真实Edge Profile、高水位和每日结果必须位于Skill目录之外。

为WorkBuddy授权：Skill目录只读/执行权限、外部状态目录读写权限、输出目录读写权限。不要把真实Profile复制进可分发压缩包。

首次运行必须检查`config/workbuddy.example.json`中的`stateDir`。在打开网站前，WorkBuddy必须询问用户今后保存房源结果的文件夹，并把用户回答作为`--output-dir`传给CLI；不得自行创建默认结果路径。CLI会把选择保存到外部状态目录，后续自动复用。

## 能力探针

在Skill根目录运行：

```powershell
node scripts/workbuddy_probe.mjs --state-dir <STATE_DIR> --output-dir <OUTPUT_DIR>
```

只有`ok=true`时才能继续。探针检查Node 20+、CLI、本地目录写入和Microsoft Edge，不打开网站、不读取Profile内容。目录能力以“写入并回读同一随机令牌”为准；安全删除钩子导致的清理失败只记录在`stateCleanupWarning`或`outputCleanupWarning`，不再误判为不可写。

## 验证顺序

1. 运行`npm run test:regression`验证四份福州/泉州人工整理HTML、标准化记录快照、小区名称数据库和专项样本。
2. 使用DeepSeek完成一次离线回归，再使用HY3完成相同回归。
3. 用户提出试运行后，先询问其要测试的平台、类别和状态，并要求用户提供对应高水位链接。不得由模型自动创建、猜测或从生产状态复制试运行高水位。
4. 将用户提供的链接写入独立试运行状态目录，使用独立输出目录和`supervise --dry-run --max-items 1`进行最小在线试跑。
5. 验证人工认证暂停和恢复；恢复时运行相同命令。
6. 通过后才允许影子运行，影子运行不得覆盖生产状态目录。

有限条数试跑中，`maxItems`只限制进入详情页的记录数量；列表仍必须继续扫描到高水位或`maxPages`上限。不得因为已收集一条候选记录就提前报告高水位缺失。

## 通过条件

- 固定样本校验值和标准化快照完全一致。
- 四个分表、行数、公式、格式和关键字段检查通过。
- 高水位缺失能逐项报告，失败时不推进状态。
- 中断恢复不重复、不从头开始。
- 不采集资产交易栏目，不自动处理验证，不发生账号写操作。

若WorkBuddy不能稳定执行长时间本地命令，再考虑增加仅暴露环境检查、高水位检查、启动、进度、恢复和验证六类操作的本地MCP；不要首先替换现有CLI。

正式任务启动后，即使模型结束当前对话，本地Supervisor仍须持续更新`stateDir\任务状态.json`并自动处理可恢复中断。用户再次询问时先读取该文件；不要要求用户通过反复提问来触发续爬。
