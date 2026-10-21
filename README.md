<div align="center">

# 🤖 AI Browser

**多模型 · 知识库 RAG · Agent 工具链的模块化 AI 浏览器 PWA**

纯前端 · 无需构建 · 零服务器 · 数据不出本机

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-purple.svg)](https://developer.mozilla.org/zh-CN/docs/Web/Progressive_web_apps)

</div>

---

## 快速开始

```bash
git clone https://github.com/unplage/browser.git
cd browser
python3 -m http.server 8080
```

打开 [localhost:8080](http://localhost:8080) → 右上角 ⚙️ → 在「模型服务商」中填入 API Key → 开始使用。

> 首次打开会提示尚未配置 Key。点击状态栏可随时查看当前生效的服务商与模型。

## v2 重构要点

| 维度 | v1 | v2 |
|------|----|----|
| 模型接入 | 3 家、参数硬编码 | **11 个内置预设 + 3 种协议适配器**（OpenAI 兼容 / Anthropic / Gemini），覆盖智谱、DeepSeek、OpenAI、Claude、Gemini、Kimi、Qwen、SiliconFlow、Groq、Ollama、LM Studio 及任意 OpenAI 兼容服务 |
| 输出长度 | 固定 131072 → 视觉模型必 400 | **按模型能力目录自动夹取**，`glm-4.6v-flash` 自动降到 32768 |
| 推理模型 | 发 `max_tokens` → o3/o4-mini 必 400 | **自动改用 `max_completion_tokens`** 并忽略非法采样参数 |
| 深度思考 | 开启但 `reasoning_content` 被丢弃，用户全程看空白 | **思考过程可展开查看**，参数按协议正确整形 |
| Markdown | 代码块**永不生成 `<pre>`**，列表/表格/链接全是纯文本 | **完整 GFM 渲染**：代码块/列表/表格/引用/链接/图片/删除线 + 语法高亮 + XSS 防护 |
| 知识能力 | 无 | **知识库 RAG**：文档入库 → 标题感知分块 → BM25 + 向量混合召回 → RRF 融合 → 带 `[S1]` 编号的可核验引用 |
| 智能体 | 无 | **Agent 工具链**：原生 function calling + 文本回退协议，内置 7 个工具，执行轨迹可视化 |
| 上下文 | 全量重发，长对话直接爆窗口 | **token 预算 + 滚动摘要 + 自动裁剪** |
| 会话 | 每模块一条，混在一起 | **独立会话线程**：新建/切换/重命名/删除/导出 |
| 模态框 | 单例，互相覆盖（设置面板被"已保存结果"摧毁） | **模态栈**，支持嵌套 |
| 离线 | CDN 依赖缺失 → 直接进"IndexedDB 不可用" | **依赖全部本地化**，实测断网后完整可用 |
| PWA 图标 | data: URI（Chrome 不认） | 真实 PNG（含 maskable） |
| 测试 | 6/17 失败（断言已失效） | **39/39 E2E + 62 单元测试全绿** |

---

## 核心能力

### 🧩 模块工作室

14 个预置专业模块 + 无限自定义模块。每个模块拥有独立的系统提示词、Provider、模型与对话会话。

| 模块 | 领域 | 默认启用 RAG |
|------|------|:---:|
| 诗歌创作 | 古典/现代诗创作与赏析 | |
| 大分子药物研发 | 抗体 / ADC / mRNA / 基因治疗 | ✅ |
| 英语学习 | 语法 / 词汇 / 写作 / 口语 | |
| 阅读天地 | 书评 / 推荐 / 文学分析 | ✅ |
| 编程乐园 | 全栈 / 算法 / 架构 | ✅ |
| 休闲一刻 | 电影 / 音乐 / 游戏 / 旅行 | |
| 宝宝天地 | 0-6 岁循证育儿 | ✅ |
| 哲学深思 | 中 / 西 / 印度哲学对话 | |
| 科技前沿 | AI / 量子 / 合成生物 / 航天 | |
| 全球要闻 | 新闻深度解读 | |
| 财经纵横 | 宏观经济 / 市场分析 | ✅ |
| 股指期货 | 衍生品定价 / 量化策略 | ✅ |
| 视觉分析 | 多模态图像识别与分析 | |
| **深度研究** | 多源检索 + 交叉验证 + 可核验引用 | ✅ |

用户可以：编辑提示词（支持恢复默认）、切换 Provider 与模型、自定义分组、拖拽排序、启用/禁用、创建与删除模块、导出预设模板。

### 📚 知识库 RAG

- **入库**：上传文件（md/txt/json/csv/code…）、抓取网址、粘贴文本
- **索引**：标题感知分块（400 tokens / 60 重叠）→ BM25 词法索引 + 可选 Embedding 向量索引（int8 量化存储）
- **检索**：BM25 + 向量双路召回 → RRF 融合 → Top-K
- **接地**：检索片段以 `[S1]`、`[S2]` 编号注入系统提示，模型必须标注引用；回答下方给出可点击的来源列表
- **降级**：未配置 Embedding 时自动退化为纯 BM25，功能不中断
- **可验证**：知识库面板内置试检索，可直接查看召回命中与打分

支持的 Embedding 模型：`text-embedding-3-small`、`embedding-3`、`text-embedding-004`、`BAAI/bge-m3`、`nomic-embed-text` 等（任意 OpenAI 兼容 Embedding 接口）。

### 🤖 Agent 工具链

开启 Agent 后，模型可自主决定调用以下工具，形成「思考 → 调�� → 观察 → 再思考」的闭环：

| 工具 | 能力 |
|------|------|
| `knowledge_search` | 在私有知识库中语义检索 |
| `knowledge_list` | 列出知识库文档 |
| `web_search` | 联网检索实时信息 |
| `web_fetch` | 抓取网页正文（自动提取可读文本） |
| `calculator` | 安全表达式计算（不使用 eval） |
| `current_time` | 当前日期时间（支持时区） |
| `search_history` | 检索历史对话 |

- 支持**原生 function calling**（OpenAI / Anthropic / Gemini）
- 不支持原生工具调用的模型自动回退到 **文本工具协议**（```` ```tool {...} ``` ````）
- 每次工具调用都会在对话中留下**执行轨迹**（工具名、参数、结果、耗时）
- 可配置最大循环轮数与最大工具调用数

### 🔍 联网搜索

三种后端，自动降级：

1. **智谱 Web Search API**（结构化结果，质量最高）
2. **外部搜索 API**（通用适配：Serper / Brave / Tavily / Bing 等，通过结果路径 + 字段名映射）
3. **SearXNG**（自建）

也可直接使用 Provider 原生搜索（OpenAI `web_search_preview`、Anthropic `web_search`、Gemini `google_search`）。

### 💬 对话体验

- SSE 流式输出，**逐字渲染 Markdown**，节流重绘不卡顿
- **深度思考过程**可展开/折叠
- 每条消息支持：复制、重新生成、编辑重发、删除
- 引用角标 `[S1]` 可点击定位到来源
- 上下文占用实时显示，超预算自动压缩并保留摘要
- 独立会话线程管理

### 📑 书签 / 文件 / 数据

- 书签：手动添加、导入浏览器 HTML（含文件夹结构）、导出 JSON、搜索与排序
- 导出/导入：覆盖 **15 张表**（模块/会话/消息/知识库/分块/向量/工具轨迹/用量/设置…），导入时 API Key 默认脱敏
- 一键清空全部数据

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 纯 HTML / CSS / JS（ES Modules，无打包器） |
| UI | 玻璃拟态 · CSS 变量 · 亮/暗/跟随系统 · 可调字号 |
| 存储 | IndexedDB（Dexie 3.2.6，15 张表，v4 迁移） |
| AI | 3 种协议适配器 · 统一流式事件 · 模型能力目录 · 参数协商 |
| 检索 | 自研分块器 + BM25 + int8 量化向量 + RRF |
| Agent | 原生 function calling + 文本回退协议 + 7 个内置工具 |
| 拖拽 | SortableJS 1.15.0 |
| 代码高亮 | highlight.js 11.9.0（主题本地化） |
| 离线 | Service Worker（应用外壳 + 全部依赖预缓存） |

> **所有第三方依赖已本地化到 `vendor/`**，无外部 CDN 依赖，离线完全可用。

## 项目结构

```
├── index.html            # 应用壳 / CSP / PWA meta
├── manifest.json         # PWA 清单（真实 PNG 图标）
├── sw.js                 # Service Worker（v3）
├── vendor/               # 本地化依赖：dexie / sortable / highlight.js / 主题
├── icons/                # PWA 图标
└── src/
    ├── app.js            # 协调器：初始化 / 状态机 / 事件绑定
    ├── db.js             # Dexie 封装（15 张表 + 备份导入导出）
    ├── modules.js        # 14 个默认模块定义 + 自定义模块 CRUD
    ├── core/
    │   ├── engine.js     # 对话引擎：LLM + RAG + Agent + 上下文管理
    │   ├── markdown.js   # GFM 安全渲染器
    │   ├── tokens.js     # token 估算 + 上下文压缩
    │   └── utils.js      # 通用工具
    ├── llm/
    │   ├── index.js      # 统一入口：chat / streamChat / embed / listModels / test
    │   ├── protocols.js  # openai / anthropic / gemini 协议适配器
    │   ├── params.js     # 参数协商（按模型能力夹取与整形）
    │   ├── catalog.js    # 模型能力目录
    │   ├── providers.js  # Provider 预设与 CRUD
    │   ├── search.js     # 联网搜索后端调度
    │   └── errors.js     # 错误归一化 + 重试退避
    ├── rag/
    │   ├── chunk.js      # 标题感知分块
    │   ├── bm25.js       # BM25 + RRF 融合
    │   ├── embed.js      # Embedding 与缓存
    │   ├── vector.js     # int8 量化向量存取
    │   ├── retrieve.js   # 混合检索与上下文构造
    │   └── ingest.js     # 入库流水线
    ├── agent/
    │   ├── runtime.js    # Agent 循环
    │   ├── tools.js      # 内置工具
    │   ├── webfetch.js   # 网页抓取与正文提取
    │   └── calc.js       # 安全表达式计算器
    └── ui/
        ├── dom.js        # DOM 助手
        ├── modal.js      # 模态栈
        ├── toast.js      # 轻提示
        ├── grid.js       # 侧边栏 + 模块网格
        ├── chat.js       # 对话面板
        ├── search.js     # 搜索视图
        ├── settings.js   # 设置面板
        ├── knowledge.js  # 知识库面板
        ├── sessions.js   # 会话列表
        ├── bookmarks.js  # 书签管理
        ├── module-editor.js
        └── markdown-view.js
```

## 键盘快捷键

| 快捷键 | 动作 |
|--------|------|
| Ctrl/⌘ + Enter | 发送消息 |
| Escape | 关闭弹窗 / 中止生成 |
| Ctrl/⌘ + K | 聚焦顶栏搜索 |
| Ctrl/⌘ + J | 聚焦聊天输入框 |
| Ctrl/⌘ + B | 打开知识库 |

## 安全与隐私

- 所有数据（会话、知识库、向量、API Key）**仅存于本机 IndexedDB**，不经过任何自建服务器
- API Key 仅在浏览器内存与 IndexedDB 中，请求时随 `Authorization` 头发送
- 导出的备份 JSON 默认对 API Key 脱敏
- Markdown 输出全部转义后再渲染，链接协议白名单校验，杜绝 XSS
- CSP 收紧为 `script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`

## 测试

```bash
# 单元测试（Markdown / 参数协商 / RAG / Agent，共 62 项）
npm test

# 端到端测试（Playwright + Firefox，共 39 项）
python3 -m http.server 8080 &   # 先启动静态服务器
npx playwright install firefox
npm run test:e2e
```

E2E 覆盖：渲染、模态栈嵌套、知识库入库与检索、流式渲染（代码块/列表/链接/思考过程）、Agent 工具调用与轨迹回灌、请求体协议合规性、会话管理、备份导入导出与脱敏、响应式布局、运行期零错误。

## 部署

推送到 GitHub 仓库根目录并开启 Pages（`master` / root）即可。零构建步骤，任意域名可用。

```bash
git push origin master
```

---

<div align="center">

<sub>Built with ❤️ · 纯前端 · 无追踪</sub>

</div>
