import { marked } from "marked"
import { markedTerminal } from "marked-terminal"
import chalk from "chalk"

// 配置marked-terminal渲染选项
marked.use(
  markedTerminal({
    // 代码块样式
    code: chalk.cyan,
    // 代码块背景
    codespan: chalk.cyan,
    // 粗体
    strong: chalk.bold.white,
    // 斜体
    em: chalk.italic,
    // 删除线
    del: chalk.strikethrough,
    // 链接
    link: chalk.blue.underline,
    // 标题
    heading: chalk.bold.green,
    // 表格边框
    tableBorder: chalk.gray,
    // 列表项
    listitem: chalk.white,
    // 引用
    blockquote: chalk.gray.italic,
    // 水平线
    hr: chalk.gray,
  }) as any
)

/**
 * 渲染markdown文本为终端格式
 */
export function renderMarkdown(markdown: string): string {
  try {
    return marked.parse(markdown, { async: false }) as string
  } catch (error) {
    console.error("Markdown渲染失败:", error)
    return markdown
  }
}

/**
 * 打印用户消息
 */
export function printUserMessage(message: string) {
  console.log(`\n${chalk.bold.blue("You:")} ${message}`)
}

/**
 * 打印助手消息（markdown渲染）
 */
export function printAssistantMessage(message: string) {
  console.log(`\n${chalk.bold.green("Assistant:")}`)
  console.log(renderMarkdown(message))
}

/**
 * 打印系统消息
 */
export function printSystemMessage(message: string) {
  console.log(chalk.gray(`[${message}]`))
}

/**
 * 打印错误消息
 */
export function printError(message: string) {
  console.log(chalk.red(`\n✗ 错误: ${message}`))
}

/**
 * 打印警告消息
 */
export function printWarning(message: string) {
  console.log(chalk.yellow(`\n⚠ 警告: ${message}`))
}

/**
 * 打印成功消息
 */
export function printSuccess(message: string) {
  console.log(chalk.green(`\n✓ ${message}`))
}

/**
 * 打印分隔线
 */
export function printDivider() {
  console.log(chalk.gray("\n" + "─".repeat(60)))
}

/**
 * 清屏
 */
export function clearScreen() {
  console.clear()
}
