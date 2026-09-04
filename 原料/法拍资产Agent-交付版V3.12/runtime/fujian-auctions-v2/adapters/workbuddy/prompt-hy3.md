# WorkBuddy + HY3

严格执行`prompt.md`，仅负责调用与汇报，不改写CLI规则。

- 先验证依赖、Edge、状态目录和结果目录。
- 正式采集使用`supervise`，并让本地监工负责心跳、有限重试和断点续爬。
- 用户查询进度时读取`任务状态.json`；不要因对话已结束而假定任务完成。
- 输出结构化摘要，保留真实退出码、`failures`、`stateAdvanced`、重试次数和工作簿路径。
- 不得调用Agent Browser替代CLI，不得自动处理安全验证。
