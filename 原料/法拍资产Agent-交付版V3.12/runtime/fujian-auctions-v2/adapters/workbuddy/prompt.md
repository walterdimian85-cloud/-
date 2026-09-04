# WorkBuddy调用约定

模型只负责任务编排、补齐用户输入和解释最终结果；页面、字段、高水位、断点、Excel及自动续爬交给V1 CLI与Supervisor。

1. 导入完整`fujian-auctions`目录，不要只导入适配提示。
2. 先运行能力探针和离线回归；不得用Agent Browser重写采集逻辑。
3. 首次采集先询问用户结果目录；高水位缺失时逐项指出平台、类别和状态。
4. 正式任务默认运行`node bin/auction-cli.mjs supervise ...`，不要直接后台启动`run`后结束监控。
5. 禁止加入`--restart`。Supervisor会按相同命令读取断点并有限重试。
6. 账号密码、短信码、验证码和滑块只允许用户人工完成。
7. 用户询问进度时读取`stateDir\任务状态.json`；只有状态为`completed`且正式任务`failures=[]、stateAdvanced=true`时才报告完整成功。
8. 汇报总数、两种状态数量、待复核数、失败数、重试次数、是否需要用户处理及最终工作簿路径。

模型不需要持续读取逐条日志，因此后台监工不会持续消耗对话Token。
