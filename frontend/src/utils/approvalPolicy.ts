/**
 * 专家委员会批复对修复工序的约束规则。
 * 规则只判断“后续工序”；已完成工序不回退、不删除，仍在修复室台账中保留。
 */
import type { CommitteeApproval } from '@/types/committeeApproval'
import type { RepairLevel } from '@/types/repairPlan'
import { REPAIR_LEVEL_LABEL } from '@/types/repairPlan'
import type { RepairName } from '@/types/repairOrder'

/** 各批复级别允许继续执行的工序。压平不改变纸质与幅面，局部修复允许使用。 */
export const LEVEL_ALLOWED_ORDERS: Record<RepairLevel, readonly RepairName[]> = {
  full: ['mend', 'mount', 'corner', 'trim', 'press'],
  partial: ['mend', 'corner', 'press'],
  reinforce: ['mend', 'corner']
}

export interface ApprovalGate {
  approval: CommitteeApproval | null
  level: RepairLevel | null
  allowed: boolean
  reason: string
}

/** 晚到批复决定当前状态：只有最新一条为“同意”时才有生效级别；驳回 / 撤回后须重发方案。 */
export function latestApprovedApproval(approvals: CommitteeApproval[]): CommitteeApproval | null {
  const latest = latestApproval(approvals)
  return latest && latest.status === 'approved' ? latest : null
}

export function latestApproval(approvals: CommitteeApproval[]): CommitteeApproval | null {
  return [...approvals].sort((a, b) => b.decidedDate.localeCompare(a.decidedDate) || b.createdAt - a.createdAt)[0] ?? null
}

export function isRepairNameAllowed(level: RepairLevel | null, name: RepairName): boolean {
  return level !== null && LEVEL_ALLOWED_ORDERS[level].includes(name)
}

export function gateRepairName(approvals: CommitteeApproval[], name: RepairName): ApprovalGate {
  const approval = latestApprovedApproval(approvals)
  if (!approval || approval.decisionLevel === null) {
    return {
      approval: null,
      level: null,
      allowed: false,
      reason: '该册尚无生效批复，须先取得专家委员会同意批复后再动手'
    }
  }
  const level = approval.decisionLevel
  const allowed = isRepairNameAllowed(level, name)
  return {
    approval,
    level,
    allowed,
    reason: allowed
      ? `当前生效批复为「${REPAIR_LEVEL_LABEL[level]}」，允许该工序`
      : `当前生效批复为「${REPAIR_LEVEL_LABEL[level]}」，该工序按批复档级挡回；已完成工序不回退`
  }
}
