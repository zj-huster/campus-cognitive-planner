# 🎓 Campus Cognitive Planner

一个基于AI的校园学习规划助手，帮助你高效管理学习目标和任务。

## ✨ 功能特性

- 📚 **智能学习规划**: 基于AI自动生成周学习计划
- 🎯 **目标管理**: 管理和跟踪学习目标
- 📊 **风险评估**: 实时评估学习进度和风险
- ⏰ **时间分配**: 智能分配学习时间
- 🤖 **AI助手**: 与AI对话，获取个性化建议
- 💬 **Markdown渲染**: 美化的终端交互界面
- 🎨 **彩色输出**: 清晰的视觉反馈

## 📦 安装

确保你已安装 [Bun](https://bun.sh)。

```bash
# 克隆项目
git clone <your-repo-url>
cd campus-cognitive-planner

# 安装依赖
bun install
```

## 🚀 使用

### 启动程序

```bash
bun run start
```

### 交互界面

程序启动后，你会看到一个类似网页版大语言模型的交互界面：

```
# 🎓 Campus Cognitive Planner

**版本**: v0.0.1  
**描述**: 基于AI的校园学习规划助手

输入 `/help` 查看帮助信息，输入 `/exit` 退出程序。

---

💭 You: 
```

### 可用命令

- `/help` - 显示帮助信息
- `/state` - 查看当前状态摘要
- `/queue` - 查看请求队列状态
- `/reset` - 清空会话历史，重新开始
- `/clear` - 清屏
- `/exit` 或 `/quit` - 退出程序

### 使用示例

#### 1. 规划学习时间

```
💭 You: 帮我规划这周的学习时间，每天可用6小时
```

#### 2. 查看状态

```
💭 You: /state
```

输出：
```markdown
**当前状态摘要**

- 🎯 风险等级: low
- ⏰ 本周可用: 42h
- 📊 本周需求: 35h
- 🔧 干预模式: none
```

#### 3. 管理目标

```
💭 You: 添加一个新的学习目标：准备期末考试
```

## 🎨 界面特性

### Markdown支持

所有回答都以美化的Markdown格式展示，支持：

- ✅ **粗体** 和 *斜体*
- ✅ `代码片段`
- ✅ 代码块（带语法高亮）
- ✅ 表格
- ✅ 列表
- ✅ 引用
- ✅ 标题
- ✅ 链接

### 彩色输出

- 🔵 **用户消息**: 蓝色
- 🟢 **助手回答**: 绿色标题 + Markdown渲染
- ⚪ **系统消息**: 灰色
- 🟡 **警告**: 黄色
- 🔴 **错误**: 红色
- 🟢 **成功**: 绿色

## 📁 项目结构

```
campus-cognitive-planner/
├── src/
│   ├── index.ts              # 主入口文件
│   ├── SYSTEM_PROMPT.md      # 系统提示词
│   ├── agent/                # Agent核心逻辑
│   │   ├── context.ts        # 上下文管理
│   │   ├── loop.ts           # 决策循环
│   │   ├── prompt.ts         # 提示词生成
│   │   ├── provider.ts       # AI模型提供者
│   │   └── request-queue.ts  # 请求队列
│   ├── tools/                # 工具集
│   │   ├── bash.ts
│   │   ├── edit-file.ts
│   │   ├── goal-tree.ts
│   │   ├── intervention.ts
│   │   ├── memory-store.ts
│   │   ├── plan-summary.ts
│   │   ├── read-file.ts
│   │   ├── risk-predict.ts
│   │   ├── scheduler.ts
│   │   ├── task-store.ts
│   │   ├── web-fetch.ts
│   │   └── write-file.ts
│   └── utils/                # 工具函数
│       ├── confirm.ts
│       ├── datetime.ts
│       ├── markdown.ts       # Markdown渲染（新增）
│       ├── safety.ts
│       └── truncate.ts
├── data/                     # 数据目录
│   ├── goals.json            # 学习目标
│   ├── tasks.json            # 学习任务
│   ├── logs/                 # 对话日志
│   └── plans/                # 学习计划
├── docs/                     # 文档
│   └── new-ui-demo.md        # 新UI演示
├── package.json
├── tsconfig.json
├── CHANGELOG.md              # 更新日志
└── README.md                 # 本文件
```

## 🔧 技术栈

- **运行时**: [Bun](https://bun.sh)
- **语言**: TypeScript
- **AI SDK**: [@ai-sdk/openai](https://sdk.vercel.ai/docs)
- **Markdown渲染**: [marked](https://marked.js.org/) + [marked-terminal](https://github.com/mikaelbr/marked-terminal)
- **终端样式**: [chalk](https://github.com/chalk/chalk)

## 📝 配置

### 环境变量

创建 `.env` 文件：

```env
# OpenAI API配置
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1

# Agent配置
AGENT_MAX_RETRIES=5
AGENT_MAX_STEPS=10
AGENT_RETRY_BASE_DELAY_MS=4000
AGENT_RETRY_MAX_DELAY_MS=60000
AGENT_RETRY_JITTER_MS=1000
AGENT_TRANSIENT_ERROR_DELAY_MS=1500
```

## 🎯 工作原理

1. **状态管理**: 维护学习目标、任务和进度
2. **风险评估**: 基于多个指标评估学习风险
3. **智能调度**: 根据优先级和可用时间分配任务
4. **AI决策**: 使用大语言模型进行智能决策
5. **工具调用**: Agent可以调用多种工具完成任务

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可

Private

## 🙏 致谢

- [Vercel AI SDK](https://sdk.vercel.ai/)
- [marked-terminal](https://github.com/mikaelbr/marked-terminal)
- [chalk](https://github.com/chalk/chalk)

---

Made with ❤️ for efficient campus learning
