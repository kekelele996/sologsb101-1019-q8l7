/**
 * 批复领域规则（委员会侧 ↔ 修复室侧对账规则集中在此）
 * - 有效批复：仅取「批复」状态，按批复日期晚到者为准（级别改了按晚到那份往下走）
 * - 驳回 / 撤回：不产生有效批复，修复室只重发本侧方案单，工序照旧（已完成工序不回退）
 * - 旧数据升级：按整册进度回填历史批复；补不出的不回填，该册只读留着
 */
import type { RepairOrder } from '@/types/repairOrder'
import {
  isOrderAllowedByLevel,
  type ApprovalLevel,
  type RepairApproval
} from '@/types/approval'

/**
 * 同册次的有效批复：
 * 先取批复日期（再比更新时间）最晚的一份委员会决定；该份若为「批复」即为当前有效级别，
 * 若为「驳回 / 撤回」则该方案尚无有效批复（修复室只重发本侧方案单、只读等候）；
 * 早先已批复的级别不被驳回 / 撤回抹掉，但在新批复到来前也不再作为动工依据。
 */
export function effectiveApproval(approvals: RepairApproval[]): RepairApproval | null {
  if (approvals.length === 0) return null
  const latest = [...approvals].sort((a, b) => {
    if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? 1 : -1
    return b.updatedAt - a.updatedAt
  })[0] as RepairApproval
  return latest.status === 'approved' ? latest : null
}

/**
 * 按整册进度判定历史批复级别：
 * - 做过（含进行中）托裱 / 裁齐 → 全面修复
 * - 做过（含进行中）溜口 / 压平，但未碰托裱 / 裁齐 → 局部修复
 * - 只有补破或完全没动过 → 加固
 * - 只出现无法识别的工序名 → 补不出，返回 null（只读留着）
 */
export function classifyLevelByProgress(
  orders: Array<Pick<RepairOrder, 'name' | 'state'>>
): ApprovalLevel | null {
  const started = orders.filter((order) => order.state !== 'todo').map((order) => order.name)
  // 全册没动过（没有任何开工工序）→ 先按加固补
  if (started.length === 0) return 'reinforce'
  if (started.some((name) => name === 'mount' || name === 'trim')) return 'full'
  if (started.some((name) => name === 'corner' || name === 'press')) return 'partial'
  if (started.every((name) => name === 'mend')) return 'reinforce'
  // 只有无法识别的工序名时补不出，留空由委员会正式批复（该册只读）
  const known = new Set(['mend', 'mount', 'corner', 'trim', 'press'])
  if (started.every((name) => !known.has(name))) return null
  return 'reinforce'
}

/** 已完成工序不回退：级别只管未完成的活 */
export function isOrderBlocked(
  order: Pick<RepairOrder, 'name' | 'state'>,
  level: ApprovalLevel | null
): boolean {
  if (order.state === 'done') return false
  return !isOrderAllowedByLevel(level, order.name)
}

/** 历史方案单号前缀（升级回填，不与委员会真实方案单混号） */
export const HISTORICAL_PLAN_PREFIX = 'HIST-'

export function historicalPlanNo(volumeId: string): string {
  return `${HISTORICAL_PLAN_PREFIX}${volumeId}`
}
