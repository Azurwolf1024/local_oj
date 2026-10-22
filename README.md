# local_oj

一个**本地、零外部依赖**的网页版 Online Judge（在线评测系统）。

- 纯 Node.js 内置模块 + 原生 HTML/JS/CSS，无需 `npm install` 任何第三方包。
- 默认运行于 http://localhost:8080
- 内置 **C++ / Python** 评测，语言可扩展（配置文件驱动）。
- 支持 **Special Judge（SPJ）**，自适应**行末空格 / 行末换行符 / CRLF** 差异，并具备 Presentation Error（PE）检测。

---

## 功能特性

- **多语言评测**：当前支持 C++（g++ 编译）与 Python，新增语言只需改配置文件，无需动代码。
- **Special Judge**：题目中放置 `spj/spj.cpp`（或 `spj.py`），系统自动编译（带编译缓存）并按约定调用。
- **宽松的输出比对**：
  - 自动剥离每行**行末空白**与文末**空行**再比较；
  - 兼容 `CRLF` / `LF` 换行符差异；
  - 完全一致判 `AC`；仅格式（多余空格/换行）不一致且开启 PE 检测时判 `PE`；否则 `WA`。
- **严格的资源限制**：
  - 时间限制：超时后杀掉**整个进程树**（含子进程），判 `TLE`；
  - 内存限制：尽力而为地采样（Windows 下为参考值，MLE 基本不触发）。
- **题目管理**（Web 界面）：
  - 新建 / 编辑 / 删除题目；
  - 题目前显示**完成状态**（AC / 最近提交结果 / 未做）；
  - **批量导入测试点**（ZIP 配对 `*.in` / `*.out`）；
  - **批量导入题目**（ZIP 包含若干 `problem.json` 子目录，支持 `skip` / `overwrite`）。
- **提交与记录**：
  - 单题提交、实时评测（串行评测队列，进程安全）；
  - 提交记录列表，支持**按题目筛选**，可查看每个测试点的详细结果。
- **无登录体系**：状态基于全部提交计算（等价于单用户自己的做题状态）。

---

## 环境要求

- **Node.js >= 18**（仅用到内置 `http` / `fs` / `child_process` / `zlib` 等模块）。
- **C++ 评测**：需要可用的 `g++`（或 `clang++`）。会自动探测 `g++` / `g++.exe` / `mingw32-g++` / `clang++`。
- **Python 评测**：需要可用的 `python`（或 `python3` / `py`）。

> 不安装编译器也能启动系统并管理题目，只是对应语言的提交会编译/运行失败。

---

## 安装与运行

```bash
# 进入项目目录
cd local_oj

# 启动（无需 npm install）
node server.js
# 或
npm start
```

启动后访问：<http://localhost:8080>

修改端口（可选）：

```bash
OJ_PORT=9000 node server.js
```

---

## 使用指南

### 1. 新建题目（Web 界面）

导航栏点击 **「新建题目」**，填写：

- **题号**（唯一，如 `1001`）、**标题**、**难度**、**时间限制(ms)**、**内存限制(MB)**；
- **题目描述 / 输入 / 输出 / 提示**；
- **样例**（可选）；
- **测试点**：逐条粘贴输入与标准输出；或点击 **「批量导入测试点」** 上传 ZIP：
  - 文件中 `1.in` 与 `1.out`（或 `.ans` / `.sol`）自动配对为一个测试点；
  - 无关文件（如 `readme.txt`）会被自动跳过。
- **Special Judge**（可选）：勾选启用，选择 `cpp` 或 `python`，粘贴 SPJ 源码。

### 2. 提交代码

在题目详情页选择语言、粘贴代码、点击提交。提交记录会显示整体判定与各测试点明细。

### 3. 批量导入题目

在「新建题目」页底部点击 **「批量导入题目」**，上传一个 ZIP：

```
archive.zip
├── 2001/
│   ├── problem.json
│   ├── tests/
│   │   ├── 1.in / 1.out
│   │   └── ...
│   └── spj/            (可选)
├── 2002/
│   └── ...
```

系统会先**预览**识别出哪些题目、是否已存在，再选择 `skip`（已存在跳过）或 `overwrite`（覆盖）执行导入。

---

## 题目目录结构

每道题是一个以题号命名的目录，位于 `problems/`：

```
problems/
└── 1002/
    ├── problem.json        # 题目元数据（标题、限制、样例、tests 列表、spj 引用）
    ├── tests/
    │   ├── 1.in            # 测试点输入
    │   ├── 1.out           # 测试点标准输出
    │   ├── 2.in
    │   └── 2.out
    └── spj/                # 仅 SPJ 题目有
        └── spj.cpp         # 特殊评测程序（自动编译，带缓存）
```

`problem.json` 关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 题号（与目录名一致） |
| `title` | 标题 |
| `timeLimit` / `memoryLimit` | 默认时限(ms) / 内存(MB) |
| `difficulty` | 难度（展示用） |
| `description` / `input` / `output` / `note` | 题面文本 |
| `samples` | 样例 `[{input, output}]` |
| `spj` | `{ "lang": "cpp", "file": "spj.cpp" }` 或 `null` |
| `tests` | `[{ "name", "in", "out", "timeLimit?", "memoryLimit?" }]` |

> 测试点也可按 `tests` 里指定的文件名存放；未指定时默认使用 `<序号>.in` / `<序号>.out`。

---

## Special Judge 约定

SPJ 程序按 **HustOJ 风格**调用：

```text
spj <输入文件> <用户输出文件> <标准输出文件>
```

- **退出码 0** → 该测试点 `AC`；
- **退出码非 0** → 该测试点 `WA`。

C++ SPJ 会被自动编译为 `spj`（Windows 下 `spj.exe`），源码改动后自动重新编译（基于 mtime 的缓存）。Python SPJ 直接以解释器运行。

示例（面积题，允许 1e-4 误差）：

```cpp
// spj/spj.cpp
#include <cstdio>
#include <cmath>
int main(int argc, char** argv) {
    if (argc < 4) return 2;
    FILE* fin = fopen(argv[1], "r");
    FILE* fout = fopen(argv[2], "r");
    double r = 0, ans = 0;
    fscanf(fin, "%lf", &r); fscanf(fout, "%lf", &ans);
    const double pi = 3.14159265358979323846;
    return fabs(ans - pi*r*r) < 1e-4 ? 0 : 1;
}
```

---

## 输出比对规则

评测时按以下顺序判定（可在 `config/languages.json` 的 `default.compare` 中开关）：

1. 将用户输出与标准输出统一换行符、剥离行末空白与文末空行后比较：
   - 相等 → **AC**；
2. 若开启 `allowPresentationError`，将两者按空白分词后比较：
   - 相等（仅格式不同）→ **PE**；
3. 否则 → **WA**。

`config/languages.json` 中相关开关：

```json
"compare": {
  "ignoreTrailingWhitespace": true,   // 剥离行末空白
  "ignoreTrailingNewline": true,      // 剥离文末空行
  "allowPresentationError": true      // 允许 PE 判定
}
```

---

## 扩展一门新语言

编辑 `config/languages.json`，在 `languages` 下新增一项即可（无需改代码）：

```json
"java": {
  "name": "Java",
  "enabled": true,
  "extensions": ["java"],
  "compile": {
    "command": "javac",
    "fallbacks": [],
    "args": ["-d", "{workdir}", "{src}"],
    "timeout": 30000
  },
  "run": {
    "command": "java",
    "args": ["-cp", "{workdir}", "Main"],
    "timeLimitGrace": 1000
  },
  "outExtension": ""
}
```

可用占位符：`{src}`（源码路径）、`{out}`（可执行输出路径）、`{workdir}`（临时工作目录）。

若编译器/解释器不在 `PATH` 中，可在 `config/judge.json` 的 `executables` 中显式指定绝对路径。

---

## 配置说明

### `config/languages.json`

- `default.compare`：全局输出比对开关（见上）。
- `default.timeLimit` / `default.memoryLimit`：默认限制（实际以题目的 `problem.json` 为准）。
- `languages.<key>`：每种语言的编译/运行配置。

### `config/judge.json`

```json
{
  "judgeConcurrency": 1,          // 并行评测数（1=串行，推荐保持 1 以保证计时准确）
  "maxSourceSizeKB": 256,         // 源码大小上限
  "tempDir": null,                // 临时目录（null=系统临时目录）
  "spj": {
    "compileTimeout": 30000,      // SPJ 编译超时
    "runTimeLimit": 10000         // SPJ 运行超时
  },
  "executables": {                // 可显式覆盖编译器/解释器路径
    "cpp":   { "compiler": null, "fallbacks": ["g++", "g++.exe", "mingw32-g++", "clang++"] },
    "python":{ "interpreter": null, "fallbacks": ["python", "python3", "py"] }
  }
}
```

---

## REST API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/languages` | 已启用语言列表与比对配置 |
| GET | `/api/problems` | 题目列表（含完成状态） |
| GET | `/api/problem/:id` | 题目详情（`?full=1` 返回可编辑表单含测试点/SPJ） |
| POST | `/api/problem` | 新建题目 |
| PUT | `/api/problem/:id` | 编辑题目（题号锁定） |
| DELETE | `/api/problem/:id` | 删除题目（带路径穿越防护） |
| POST | `/api/submit` | 提交代码，返回 `submissionId` |
| GET | `/api/submission/:id` | 单条提交结果（含各测试点明细） |
| GET | `/api/submissions` | 提交列表（`?problemId=` 过滤，`?limit=` 限制） |
| POST | `/api/problem/parse-cases` | 解析 ZIP 测试点（配对预览） |
| POST | `/api/problems/import-preview` | 批量导入题目预览 |
| POST | `/api/problems/import` | 批量导入题目（`mode: skip|overwrite`） |

评测结果判定（verdict）：`AC` / `PE` / `WA` / `TLE` / `MLE` / `RE` / `CE` / `SE`。

---

## 项目结构

```
local_oj/
├── server.js                 # HTTP 服务、静态资源、REST API、串行评测队列
├── config/
│   ├── languages.json        # 语言与输出比对配置（可扩展）
│   └── judge.json            # 评测全局配置
├── src/
│   ├── judge.js              # 编译/运行、资源限制、输出比对、SPJ
│   ├── problems.js           # 题目读写、编辑删除、批量导入
│   ├── storage.js            # 提交记录存储（data/submissions/）
│   ├── util.js               # 进程树杀、内存采样、路径工具
│   └── zip.js                # 零依赖 ZIP 解析（stored/deflate）
├── problems/                 # 题目数据（1001~1003 为内置示例）
├── public/                   # 前端（index.html / app.js / styles.css）
├── launcher/                 # 一键启动托盘小程序的源码与构建脚本
├── local_oj_launcher.exe     # 编译产物：双击即启动并驻留托盘
└── data/submissions/         # 提交记录（运行时生成，已被 .gitignore 忽略）
```

---

## 一键启动（桌面托盘启动器）

不想开命令行？项目根目录提供了 **`local_oj_launcher.exe`**——一个零依赖的 Windows 托盘小程序，双击即可：

1. 自动定位 `node.exe`（查找顺序见下）；找不到时会**弹窗让你手动选择 node.exe**，选择结果自动记到 `local_oj.json`，下次免选；
2. 在**后台**启动 `node server.js`（进程树被 Job / 进程树终止逻辑管理）；
3. 在系统托盘显示图标，**右键（或左键）点击**弹出菜单：
   - **打开网页**：用默认浏览器打开 `http://localhost:<端口>/`；
   - **退出服务**：终止 node 及全部子进程并退出。

> 启动器会从**自身所在目录**查找 `server.js`，请把它放在项目根目录（与 `server.js` 同级）。

### node.exe 的查找顺序

启动器按以下顺序定位 `node.exe`，命中即止：

1. 环境变量 `OJ_NODE`（显式完整路径）；
2. 启动器同目录下的 `local_oj.json` 配置文件中的 `node` 字段（手动选择后自动写入）；
3. 系统 `PATH` 中的 `node.exe`；
4. **WorkBuddy 托管 Node**：`%USERPROFILE%\.workbuddy\binaries\node\versions\<版本>\node.exe`；
5. **nvm**：`%USERPROFILE%\AppData\Roaming\nvm\<版本>\node.exe` 与 `%USERPROFILE%\.nvm\<版本>\node.exe`；
6. 常见安装目录：`C:\Program Files\nodejs\node.exe`、`C:\Program Files (x86)\nodejs\node.exe`。

> 如果你是 WorkBuddy 环境或用了 nvm，启动器现在能**自动识别**，无需手动设置。

### 配置（可选）

| 变量 / 文件 | 作用 | 默认 |
| --- | --- | --- |
| `OJ_NODE` | 显式指定 `node.exe` 的完整路径 | 自动查找 |
| `OJ_PORT` | 服务端口 | `8080` |
| `local_oj.json` | 自动生成；也可手写 `{ "node": "C:\\path\\to\\node.exe" }` | — |

例如：`OJ_PORT=9000 local_oj_launcher.exe`。

若 `8080` 端口已被占用（已有服务在跑），启动器会检测到并提示"已在运行"，仅提供"打开网页"，不会重复拉起。

### 自行重新编译

源码在 `launcher/`，需要 MinGW-w64 的 `g++` 与 `windres`（Windows 下直接双击 `launcher/build.bat`；Git Bash / MSYS2 下运行 `bash launcher/build.sh`）。产物输出到项目根目录的 `local_oj_launcher.exe`。

```
launcher/
├── launcher.cpp   # 托盘 + node 拉起 + 进程树回收
├── launcher.rc    # 图标资源
├── make_icon.py   # 生成 app.ico（蓝底白环）
├── build.bat      # Windows 构建脚本
└── build.sh       # Git Bash / MSYS2 构建脚本
```

---

## 已知限制

- **内存限制**在 Windows 下为尽力而为（基于轮询采样），MLE 通常不准确；**时间限制**是严格保证的。
- **无多用户 / 登录体系**，状态基于全部提交。
- 评测为**单进程串行队列**（默认 `judgeConcurrency: 1`），适合本地使用；高并发请谨慎调高（可能影响计时精度）。

---

## 许可证

MIT —— 详见 [LICENSE](./LICENSE)。
