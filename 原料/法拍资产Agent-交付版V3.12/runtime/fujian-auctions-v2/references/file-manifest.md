# 文件用途

- `SKILL.md`：入口规则与按需参考路由。
- `用户操作手册.md`：安装、探针、回归、试运行与每日正式运行说明。
- `bin/auction-cli.mjs`：统一命令行入口。
- `scripts/`：运行编排、Supervisor监工、工作簿生成、自检和WorkBuddy能力探针。
- `src/extractors/`：面积、标的名称、小区名称及字段证据的唯一解析入口。
- `src/`其他目录：配置、URL、基础文本处理和标准工作簿适配器。
- `references/`：平台、字段、高水位、恢复、安全、试运行和发行规则。
- `adapters/`：通用、DeepSeek、HY3与WorkBuddy轻量提示。
- `config/`：默认配置、示例配置和结构约束。
- `assets/`：房源信息整理模板、人工小区名称清单及生成后的结构化小区数据库。
- `tests/fixtures/curated-html/`：福州/泉州房源上新与法拍结果四份人工整理HTML及校验清单，是正式离线回归原始样本。
- `tests/fixtures/curated-training/`：由人工样本生成的标准化字段快照与竞买参与数据标准答案。
- `tests/fixtures/special-cases.json`、`tests/fixtures/v2-golden.json`：专项解析样本和V2字段正确答案。
- `tests/regression/`：固定样本与专项回归执行脚本。
- `tests/fixtures/v2-golden.json`：用户确认的V2字段正确答案，不通过重写V1工作簿更新。
- `tests/productization_check.mjs`：路径与产品化规则检查。
- `tests/supervisor_check.mjs`：锁、完成判定、人工门禁和自动重试检查。
- `tests/release_check.mjs`：个人路径、浏览器敏感文件和私钥特征检查。
- `package.json`、`package-lock.json`：Node版本、锁定依赖和测试命令。

发行包保留可复现回归所需的导入/构建脚本和人工样本，刻意排除一次性分析脚本、训练过程报告、原始在线采集证据、真实状态、每日结果、`node_modules`和所有临时产物。
