<div align="center">

# 🤖 AI Browser

**一个基于智谱 GLM-4-Flash 的模块化 AI 浏览器 PWA**

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

打开 [localhost:8080](http://localhost:8080)，点击右上角 ⚙️ → 填入[智谱 API Key](https://open.bigmodel.cn)（免费，注册即送额度），即可开始使用。

## 特色

### 🧩 模块工作室
12 个预置专业模块 + 无限自定义模块，每个模块拥有独立的系统提示词和对话历史。

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

**用户可以：**
- 编辑任意模块的系统提示词（支持一键恢复默认）
- 自由创建自定义模块（名称/图标/提示词完全自定义）
- 删除自定义模块（预置模块受保护）
- 拖拽排序、启用/禁用

### 🔍 联网搜索聚合
内置 GLM-4 `web_search` 能力，一键联网搜索并生成结构化分析报告，结果可保存到本地数据库。

### 📑 智能书签
- 手动添加、导入 HTML 书签文件、导出 JSON
- 一键保存当前搜索分析结果
- Favicon 自动获取

### 📎 文件分析
上传 `.txt / .md / .json / .csv / .js / .py / .html` 等文本文件，AI 自动分析内容。

### 💬 流式对话
SSE 流式实时输出，逐字渲染 Markdown，响应更流畅。

### 📱 PWA 支持
- 可安装到桌面（`display: standalone`）
- Service Worker 离线缓存
- 全平台响应式布局

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 纯 HTML/CSS/JS（ES Modules） |
| UI 风格 | 玻璃拟态 · 渐变背景 · macOS 美学 |
| 存储 | IndexedDB（Dexie.js 封装） |
| AI | 智谱 GLM-4-Flash API（流式 SSE） |
| 拖拽 | SortableJS |
| 离线 | Service Worker（缓存优先） |

## 项目结构

```
├── index.html          # 应用壳、CDN 依赖、PWA meta
├── manifest.json       # PWA 清单（display: standalone）
├── sw.js               # Service Worker 离线缓存
├── favicon.svg         # 图标
└── src/
    ├── app.js          # 协调器：初始化、状态机、事件绑定
    ├── ui.js           # 所有 DOM 渲染（侧栏/网格/对话/弹窗）
    ├── db.js           # Dexie 数据库封装（7 张表）
    ├── api.js          # GLM-4 API 封装（流式+搜索+文件分析）
    ├── modules.js      # 模块定义与增删改查
    └── styles.css      # 全套样式（CSS 变量/玻璃拟态/动画）
```

## API 说明

- **接口**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **模型**: `glm-4-flash`（免费，128K 上下文）
- **认证**: Bearer Token（API Key 仅存本地）
- **流式**: `response.body.getReader()` 逐块读取
- **联网**: 请求体中传入 `web_search: true` 即可，无需额外 API Key
- **限频**: 约 1 req/s，1 并发（免费版）

## 本地开发

```bash
# 启动
python3 -m http.server 8080

# 测试（需要 Node.js）
npm install
npx playwright install firefox
node run-test.cjs
```

## 部署

推送到 GitHub 仓库根目录，开启 Pages（`main` / root）即可。零构建步骤。

```bash
git push origin main
```

---

<div align="center">

<sub>Built with ❤️ and [GLM-4-Flash](https://open.bigmodel.cn)</sub>

</div>
