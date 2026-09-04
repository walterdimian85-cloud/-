# WorkBuddy交接区

这里是采集区与三产物生成区之间的固定交接位置，按日期建立子目录：

```text
WorkBuddy交接\20260828\
├─ manifest.json
├─ 20260828采集验收表.xlsx
└─ 20260828三产物输入.json
```

WorkBuddy每天只读取对应日期目录中的 `manifest.json`，不得扫描法拍Agent批次目录，也不得直接读取采集断点、原始证据或过程文件。

当前 `20260827` 子目录中的JSON是昨日AI补采过程文件，不能直接作为最终三产物输入；正式交接文件应以 `manifest.json` 指定的文件为准。
