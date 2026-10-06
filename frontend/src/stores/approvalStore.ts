/**
 * 方案批复 store（Pinia setup store）
 * 专家委员会一侧：按方案单号 + 册次号登记批复（全面 / 局部 / 加固）。
 * 与修复室各记各的：本 store 只读写 approvals 表，绝不改动古籍 / 册次 / 工序；
 * 两侧靠册次号（volumeId）对账，有效级别由 utils/approval 的规则派生。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createId, db } from '@/utils/db'
import type { ApprovalLevel, RepairApproval, RepairApprovalDraft } from '@/types/approval'
import { effectiveApproval } from '@/utils/approval'

export const useApprovalStore = defineStore('approval', () => {
  const approvals = ref<RepairApproval[]>([])
  const loading = ref(false)
  const ready = ref(false)
  const error = ref('')

  async function loadApprovals(): Promise<void> {
    loading.value = true
    try {
      const rows = await db.approvals.toArray()
      rows.sort((a, b) => (a.decidedAt === b.decidedAt ? b.updatedAt - a.updatedAt : a.decidedAt < b.decidedAt ? 1 : -1))
      approvals.value = rows
      error.value = ''
      ready.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '批复读取失败'
    } finally {
      loading.value = false
    }
  }

  /** 某册次的全部批复（含驳回 / 撤回留痕），按晚到在前排序 */
  function approvalsOfVolume(volumeId: string): RepairApproval[] {
    return approvals.value
      .filter((item) => item.volumeId === volumeId)
      .sort((a, b) => (a.decidedAt === b.decidedAt ? b.updatedAt - a.updatedAt : a.decidedAt < b.decidedAt ? 1 : -1))
  }

  /** 某册次当前生效的批复；没有有效批复时返回 null（修复室侧只读） */
  function effectiveOfVolume(volumeId: string): RepairApproval | null {
    return effectiveApproval(approvalsOfVolume(volumeId))
  }

  /** 某册次当前生效级别，未批复 / 仅驳回 / 仅撤回时为 null */
  function levelOfVolume(volumeId: string): ApprovalLevel | null {
    return effectiveOfVolume(volumeId)?.level ?? null
  }

  async function createApproval(draft: RepairApprovalDraft): Promise<RepairApproval> {
    const now = Date.now()
    const row: RepairApproval = { ...draft, id: createId('approval'), createdAt: now, updatedAt: now }
    await db.approvals.put(row)
    await loadApprovals()
    return row
  }

  async function updateApproval(id: string, patch: Partial<RepairApproval>): Promise<void> {
    await db.approvals.update(id, { ...patch, updatedAt: Date.now() } as never)
    await loadApprovals()
  }

  async function removeApproval(id: string): Promise<void> {
    await db.approvals.delete(id)
    await loadApprovals()
  }

  const totalCount = computed(() => approvals.value.length)
  const effectiveCount = computed(() => {
    const byVolume = new Map<string, RepairApproval[]>()
    approvals.value.forEach((item) => {
      const list = byVolume.get(item.volumeId) ?? []
      list.push(item)
      byVolume.set(item.volumeId, list)
    })
    let count = 0
    byVolume.forEach((list) => {
      if (effectiveApproval(list)) count += 1
    })
    return count
  })

  return {
    approvals,
    loading,
    ready,
    error,
    totalCount,
    effectiveCount,
    loadApprovals,
    approvalsOfVolume,
    effectiveOfVolume,
    levelOfVolume,
    createApproval,
    updateApproval,
    removeApproval
  }
})
