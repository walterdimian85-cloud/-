# 本地监工与自动续爬

## 默认命令

正式每日采集使用：

```powershell
node bin/auction-cli.mjs supervise --config config/workbuddy.example.json --output-dir "<结果目录>"
```

首次明确传入结果目录后，后续可省略`--output-dir`。Supervisor与CLI均在本地运行，不需要模型逐条读取页面或持续轮询。

## 监工职责

- 在外部状态目录写入`任务状态.json`，默认每30秒更新心跳。
- 读取当日`采集进度.json`的当前位置、数量和更新时间。
- 使用`locks\auction-YYYYMMDD.lock`保证每天只有一个监工实例。
- 网络超时、Edge异常退出、页面加载异常或进程无结果退出时，按原命令断点续爬。
- 默认最多重试5次，依次等待30秒、1分钟、2分钟、5分钟、10分钟。
- 默认连续20分钟既无控制台活动也无进度文件更新时判定停滞，结束本次子进程并断点重启。
- 禁止自动加入`--restart`，禁止清空当日进度。
- 完成、需要人工处理或重试耗尽时尝试发送Windows桌面通知；通知失败不改变任务状态。

## 不自动重试的情况

- 登录、短信码、验证码或滑块需要用户处理。
- 高水位缺失或未找到昨日锚点。
- 列表筛选或排序无法确认。
- 其他必须由用户决定的业务门禁。

遇到这些情况时，将`任务状态.json`写为`needs_user_action`并停止重试。人工认证发生在仍运行的Edge会话中时，Supervisor保持等待；用户完成后CLI继续。

## 状态含义

- `starting`：准备启动CLI。
- `running`：CLI正在运行，心跳正常。
- `needs_user_action`：需要人工认证或业务输入。
- `waiting_to_retry`：可恢复失败，等待下一次断点续爬。
- `retrying`：正在重新启动CLI。
- `completed`：退出码、失败清单和状态推进均满足完成条件。
- `failed`：自动重试次数已用完。

正式任务只有`status=completed`、`failures=[]`和`stateAdvanced=true`同时成立才算完成。试运行要求`status=completed`、`failures=[]`、`dryRun=true`和`stateAdvanced=false`。

## 查询方式

用户询问进度时，优先读取外部状态目录的`任务状态.json`，再按需读取当日`采集进度.json`和`运行结果.json`。无需重新启动任务；若锁文件对应的进程仍存活，重复调用监工只返回现有任务状态，不再创建第二个采集进程。
