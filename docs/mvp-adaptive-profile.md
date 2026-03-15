# 自适应学习画像 MVP 说明

## 目标

本次 MVP 让调度器具备基础“自学习”能力：

1. 任务完成后自动更新学习画像。
2. 周任务分配时考虑科目效率差异。
3. 日程编排时考虑不同时段专注差异。
4. 提供画像摘要，便于查看和答辩展示。

## 新增数据文件

- `data/learner-profile.json`

首次运行时会自动创建默认画像。结构如下：

```json
{
  "version": 1,
  "updatedAt": "2026-03-15 10:30:00",
  "taskRecords": 12,
  "subjectEfficiency": {
    "数学": 1.08,
    "英语": 0.94
  },
  "slotFocus": {
    "早1": 1,
    "早2": 1.05,
    "中1": 0.96,
    "中2": 0.92,
    "晚1": 1.02,
    "晚2": 0.98
  }
}
```

## 实现逻辑

### 1) 在线更新（任务完成后）

代码位置：

- `src/tools/task-store.ts`
- `src/tools/learner-profile.ts`

当任务被标记为 `completed` 时：

1. 计算观测效率：`observed = plannedHours / actualHours`。
2. 将效率限制到 `[0.6, 1.4]`，防止异常值扰动。
3. 用指数滑动平均更新画像参数：
   - `new = old * (1 - alpha) + observed * alpha`
   - `alpha = 0.25`
4. 更新两个维度：
   - 科目效率因子（数学/英语/政治/408/通用）
   - 时段专注因子（早1/早2/中1/中2/晚1/晚2）

### 2) 周调度个性化

代码位置：`src/tools/scheduler.ts`

原权重：

- `baseWeight = calculateWeight(goal)`

MVP 权重：

- `personalWeight = baseWeight * subjectEfficiencyFactor`

含义：同样紧急和重要的目标，系统会更倾向分配到你“更擅长完成”的科目。

### 3) 日计划时段个性化

代码位置：`src/tools/scheduler.ts`

每个时间槽位（早1/早2/中1/中2/晚1/晚2）会在候选目标中选择 `remainingHours * slotAdjustedFactor` 最高的目标。

其中：

- `slotAdjustedFactor = subjectEfficiencyFactor * slotFocusFactor`

含义：在高专注时段优先安排更适合该时段和该科目的任务。

### 4) 查询画像摘要

新增工具：`get_learner_profile_summary`

可输出：

- 样本任务数
- 最近更新时间
- 科目效率因子排名
- 时段专注因子

## 如何使用

1. 正常生成计划并执行任务。
2. 用 `update_task` 或 `mark_task_completed` 标记完成并填写实际时长。
3. 多完成几条任务后，调用 `get_learner_profile_summary` 查看画像变化。
4. 再次 `generate_schedule` / `generate_daily_schedule`，观察分配差异。

## 预期效果（答辩可讲）

1. 从静态规则调度升级为“用户行为驱动调度”。
2. 调度策略可以随着用户使用自动演化。
3. 具备可解释性：能明确说出“为何把某任务放到某时段”。

## 已知限制（MVP 范围）

1. 科目识别基于关键词，后续可改为标签化目标。
2. 未引入节假日/课程表约束，后续可接入课表数据。
3. 风险模型暂未直接使用画像参数，后续可联动风险预测。

## 下一步建议

1. 增加 `what-if` 模拟：比较“20h vs 30h”下风险与计划差异。
2. 在周计划报告中增加“画像驱动解释卡片”。
3. 将画像加入风险模型，输出更个性化干预建议。
