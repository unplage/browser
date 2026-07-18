<div align="center">

# 🤖 AI Browser

**模块化 AI 浏览器 PWA · 多 Provider 支持**

纯前端 · 无需构建 · 零服务器 · 即开即用

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

打开 [localhost:8080](http://localhost:8080)，点击右上角 ⚙️ → 在 API 服务商配置中填入 API Key。选择你需要的 Provider：

| Provider | 预设模型 | 免费额度 |
|----------|----------|----------|
| 智谱 GLM | `glm-4.7-flash` / `glm-4.6v-flash` | 注册即送，128K 上下文 |
| DeepSeek | `deepseek-v4-flash` / `deepseek-v4-pro` | 注册即送 |
| OpenAI | `gpt-4o` / `gpt-4o-mini` / `o3` / `o4-mini` 等 | 需付费 |

> 支持同时配置多个 Provider，每个模块可独立选择使用的 Provider 和模型。联网搜索功能由智谱 GLM 的 `web_search` 提供，使用其他 Provider 时暂不支持联网搜索。

## 特色

### 🧩 模块工作室
13 个预置专业模块 + 无限自定义模块，每个模块拥有独立的系统提示词、对话历史、Provider 和模型选择。

| 模块 | 领域 | 图标 |
|------|------|------|
| 诗歌创作 | 古典/现代诗创作与赏析 | ✍️ |
| 大分子药物研发 | 抗体/ADC/mRNA/基因治疗 | 🧬 |
| 英语学习 | 语法/词汇/写作/口语 | 📖 |
| 阅读天地 | 书评/推荐/文学分析 | 📚 |
| 编程乐园 | 全栈/算法/架构 | 💻 |
| 休闲一刻 | 电影/音乐/游戏/旅行 | 🎮 |
| 宝宝天地 | 0-6 岁循证育儿 | 👶 |
| 哲学深思 | 中/西/印度哲学对话 | 🧠 |
| 科技前沿 | AI/量子/合成生物/航天 | 🔬 |
| 全球要闻 | 新闻深度解读 | 🌍 |
| 财经纵横 | 宏观经济/市场分析 | 📈 |
| 股指期货 | 衍生品定价/量化策略 | 📊 |
| 视觉分析 | 多模态图像识别与分析 | 👁️ |

**用户可以：**
- 编辑任意模块的系统提示词（支持一键恢复默认）
- 为每个模块选择不同的 Provider 和模型
- 自由创建自定义模块（名称/图标/提示词/Provider/模型完全自定义）
- 删除自定义模块（预置模块受保护）
- 拖拽排序、启用/禁用

### 🔍 联网搜索聚合
内置智谱 GLM `web_search` 能力，一键联网搜索并生成结构化分析报告，结果可保存到本地数据库。

### ⚙️ 多 API 服务商
- 支持智谱 GLM、DeepSeek、OpenAI 三个内置 Provider 预设
- 可添加自定义 Provider（兼容 OpenAI 格式的任意 API）
- 每个 Provider 独立配置 API Key、地址、模型列表、参数（temperature、top_p、max_tokens、thinking、do_sample、reasoning_effort 等）
- 参数按 Provider 全局生效，支持的参数随 Provider 动态适配

### 📑 智能书签
- 手动添加、导入 HTML 书签文件、导出 JSON
- 一键保存当前搜索分析结果
- Favicon 自动获取

### 📎 文件分析
上传 `.txt / .md / .json / .csv / .js / .py / .html / .ts / .tsx / .css / .xml / .yaml / .yml / .log / .ini / .cfg` 等文本文件及图片，AI 自动分析内容。图片分析需使用视觉模型（如 `glm-4.6v-flash`）。

### 💬 流式对话
SSE 流式实时输出，逐字渲染 Markdown，响应更流畅。支持中止生成（Esc / ⏹️）。

### 🔤 字体大小调节
设置面板中可通过滑块调节全局字体大小（10–24px），即时预览，持久化保存。

### 📱 PWA 支持
- 可安装到桌面（`display: standalone`）
- Service Worker 离线缓存
- 全平台响应式布局

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 纯 HTML/CSS/JS（ES Modules） |
| UI 风格 | 玻璃拟态 · 渐变背景 · macOS 美学 |
| 存储 | IndexedDB（Dexie.js 封装，8 张表） |
| AI | 智谱 GLM / DeepSeek / OpenAI / 兼容 API（流式 SSE） |
| 拖拽 | SortableJS |
| 代码高亮 | highlight.js |
| 离线 | Service Worker（缓存优先） |

## 项目结构

```
├── index.html          # 应用壳、CDN 依赖、PWA meta、CSP
├── manifest.json       # PWA 清单（display: standalone）
├── sw.js               # Service Worker 离线缓存
├── favicon.svg         # 图标
└── src/
    ├── app.js          # 协调器：初始化、状态机、事件绑定（含 Provider 联动）
    ├── ui.js           # 所有 DOM 渲染（侧栏/网格/对话/弹窗/设置面板）
    ├── db.js           # Dexie 数据库封装（8 张表：含 presets）
    ├── api.js          # 多 Provider API 封装（动态参数协商/流式/搜索/文件分析）
    ├── modules.js      # 13 个默认模块定义 + 自定义模块 CRUD（含 providerId）
    └── styles.css      # 全套样式（CSS 变量/玻璃拟态/动画/字体大小变量）
```

## API 架构

每个 Provider 可独立配置参数，`buildRequestBody()` 根据 Provider 的 `params` 定义自动协商支持的请求参数：

| 参数 | 智谱 GLM | DeepSeek | OpenAI |
|------|----------|----------|--------|
| `temperature` | ✅ | ✅ | ✅ |
| `top_p` | ✅ | ✅ | ✅ |
| `max_tokens` | ✅ | ✅ | ✅ |
| `thinking` | ✅ (`{type: "enabled"}`) | ✅ (布尔) | ❌ |
| `do_sample` | ✅ | ❌ | ❌ |
| `reasoning_effort` | ❌ | ✅ (`high`/`max`) | ❌ |
| `web_search` | ✅ (tools) | ❌ | ❌ |

- **认证**: Bearer Token（API Key 仅存本地 IndexedDB）
- **流式**: `response.body.getReader()` 逐块读取 SSE
- **限频**: 取决于 Provider 免费版限制
- **CSP**: 动态更新 `connect-src` 以适配已配置的 Provider API 地址

## 键盘快捷键

| 快捷键 | 动作 |
|--------|------|
| Ctrl+Enter | 发送消息 |
| Escape | 关闭弹窗 / 中止生成 |
| Ctrl+K | 聚焦搜索输入框 |
| Ctrl+N | 聚焦聊天输入框 |

## IndexedDB 表结构

| 表 | 用途 |
|----|------|
| `modules` | 模块定义（含 `providerId`、`model`） |
| `layout` | 布局配置 |
| `bookmarks` | 书签管理 |
| `searchResults` | 搜索历史 |
| `chatHistory` | 对话历史 |
| `files` | 上传的文件记录 |
| `settings` | 键值存储（Provider 配置、主题、字体大小等） |
| `presets` | 模块预设模板 |

## 本地开发

```bash
# 启动
python3 -m http.server 8080

# 测试（需要 Node.js + Firefox）
npm install
npx playwright install firefox
node run-test.cjs
```

> 测试使用 Playwright + Firefox，无需 API Key。17 个测试覆盖 DOM 渲染、弹窗、IndexedDB 表结构等。

## 部署

推送到 GitHub 仓库根目录，开启 Pages（`main` / root）即可。零构建步骤。

```bash
git push origin master
```

---

<div align="center">

<sub>Built with ❤️ and GLM / DeepSeek / OpenAI</sub>

</div>
