# 状态范围接口约定

- 新建任务以已保存的 `collection.selectedStatuses` 创建批次；服务端会规范为“即将开始、已结束”的稳定顺序，并保存 `statusScope`、`expectedGroupCount` 和动态 `workbookPath`。
- `GET /api/status` 返回当前任务的 `selectedStatuses` 与 `statusScope`；`GET /api/tasks` 返回归档批次同名字段和 `statusLabel`。
- 恢复只接受 `taskId` 与 `batchId`，并使用批次持久化的范围和路径，不能读取页面后来改动的选择。
- 分组数为：平台数 × 类别数 × 城市数（全省为 1）× 已选状态数。单状态 12/12 即可进入复核。
- 旧批次优先读取 `collection.status`；无法确定时按双状态读取，且不会写回断点或水位。
