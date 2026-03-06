// ========== 请求队列管理器 ==========
// 防止并发请求导致限流，按顺序提交API调用

export interface QueuedRequest<T> {
  id: string
  task: () => Promise<T>
  priority: number // 0=highest, 100=lowest
  createdAt: Date
  resolve?: (value: T) => void
  reject?: (reason: Error) => void
}

export class RequestQueue {
  private queue: QueuedRequest<any>[] = []
  private processing = false
  private requestsInFlight = 0
  private lastRequestTime = 0

  // 配置参数
  private maxConcurrent: number = 1 // 最多同时发出1个请求
  private minIntervalMs: number = 2000 // 请求间隔最少2000ms（增加到2秒以避免限流）

  constructor(maxConcurrent: number = 1, minIntervalMs: number = 2000) {
    this.maxConcurrent = maxConcurrent
    this.minIntervalMs = minIntervalMs
  }

  /**
   * 提交任务到队列
   * @param task 异步函数
   * @param priority 优先级（0最高，100最低，默认50）
   * @returns 返回完成的Promise
   */
  async enqueue<T>(task: () => Promise<T>, priority: number = 50): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req-${Date.now()}-${Math.random()}`,
        task,
        priority,
        createdAt: new Date(),
        resolve: resolve as (value: unknown) => void,
        reject,
      }

      this.queue.push(request)
      // 按优先级排序（优先级低的排前面）
      this.queue.sort((a, b) => a.priority - b.priority)

      console.log(
        `\x1b[90m[队列] 新增任务 ${request.id}，当前队列长度: ${this.queue.length}\x1b[0m`
      )

      this.processQueue()
    })
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.requestsInFlight >= this.maxConcurrent) {
      return
    }

    if (this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0 && this.requestsInFlight < this.maxConcurrent) {
      const request = this.queue.shift()
      if (!request) break

      // 计算需要等待的时间
      const timeSinceLastRequest = Date.now() - this.lastRequestTime
      const waitMs = Math.max(0, this.minIntervalMs - timeSinceLastRequest)

      if (waitMs > 0) {
        console.log(
          `\x1b[90m[队列] 等待 ${waitMs}ms 后发送请求 ${request.id}...\x1b[0m`
        )
        await this.sleep(waitMs)
      }

      this.requestsInFlight++
      this.lastRequestTime = Date.now()

      // 执行任务（不等待，允许并发）
      ;(async () => {
        try {
          console.log(
            `\x1b[36m[队列] 执行请求 ${request.id}（飞行中: ${this.requestsInFlight}）\x1b[0m`
          )
          const result = await request.task()
          request.resolve?.(result)
          console.log(
            `\x1b[32m[队列] ✓ 请求完成 ${request.id}\x1b[0m`
          )
        } catch (error) {
          request.reject?.(error as Error)
          console.log(
            `\x1b[31m[队列] ✗ 请求失败 ${request.id}: ${(error as Error).message}\x1b[0m`
          )
        } finally {
          this.requestsInFlight--
          this.processQueue() // 继续处理队列
        }
      })()
    }

    this.processing = false
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    queueLength: number
    processing: boolean
    requestsInFlight: number
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      requestsInFlight: this.requestsInFlight,
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = []
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// 全局队列实例（单例）
let globalQueue: RequestQueue | null = null

export function getGlobalQueue(): RequestQueue {
  if (!globalQueue) {
    // 配置：最多1个并发请求，请求间隔2000ms
    globalQueue = new RequestQueue(1, 2000)
  }
  return globalQueue
}

export function resetGlobalQueue(): void {
  globalQueue = null
}
