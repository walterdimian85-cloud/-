# 安装与环境

## 首要支持环境

- Windows 10/11
- Microsoft Edge
- Node.js 20或更高版本
- 可写的状态目录和结果目录

运行`npm ci`安装锁定依赖。使用`node bin/auction-cli.mjs help`验证CLI。

默认不在Skill目录保存登录信息。将`stateDir`和`profileDir`指向Skill目录外的用户数据目录。

首次采集必须先询问用户今后保存房源结果的文件夹。用户提供后通过`--output-dir DIR`传入；CLI把选择记录到外部`stateDir\output-settings.json`并在以后自动复用。用户没有明确选择、且状态目录中没有历史设置时，CLI必须在打开Edge前停止并返回可操作提示。不得静默回退到Skill目录或模型自行推断的路径。

Codex环境可使用`workbookAdapter=codex`；其他模型宿主默认使用`workbookAdapter=standard`。模型必须能够执行本地命令、访问文件并启动Edge，否则只能解释规则，不能完成采集。

## 配置优先级

命令行参数覆盖`--config`指定的JSON；配置文件覆盖程序内置默认值。配置文件中的相对路径以配置文件所在目录为基准。发行版示例配置刻意不预设`outputDir`，以确保新用户第一次运行时完成目录选择。

不得将真实Profile、Cookie、高水位状态或每日结果放入公开发行包。
