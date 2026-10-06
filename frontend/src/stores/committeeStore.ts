/**
 * 专家委员会上下文 store
 * 修复室方案单与委员会批复分表维护：委员会不直接改写修复室工序。
 * 两侧各自登记，修复室按收藏号 + 册次号对账后读取最新“同意”批复。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { createId, db } from '@/utils/db'
import type { CommitteeApproval, CommitteeApprovalDraft } from '@/types/committeeApproval'
import type { RepairPlan, RepairPlanDraft } from '@/types/repairPlan'
import { latestApproval, latestApprovedApproval } from '@/utils/approvalPolicy'

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export const useCommitteeStore = defineStore('committee', () => {
  const plans = ref<RepairPlan[]>([])
  const approvals = ref<CommitteeApproval[]>([])
  const loading = ref(false)
  const ready = ref(false)
  const error = ref('')

  async function loadCommitteeData(): Promise<void> {
    loading.value = true
    try {
      const [planRows, approvalRows] = await Promise.all([db.repairPlans.toArray(), db.committeeApprovals.toArray()])
      plans.value = planRows.sort((a, b) => b.submittedDate.localeCompare(a.submittedDate) || b.createdAt - a.createdAt)
      approvals.value = approvalRows.sort((a, b) => b.decidedDate.localeCompare(a.decidedDate) || b.createdAt - a.createdAt)
      error.value = ''
      ready.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '方案批复数据读取失败'
    } finally {
      loading.value = false
    }
  }

  function approvalsForVolumeKey(collectionNo: string, volumeNo: number): CommitteeApproval[] {
    return approvals.value.filter((item) => item.collectionNo === collectionNo && item.volumeNo === volumeNo)
  }

  function plansForVolume(volumeId: string): RepairPlan[] {
    return plans.value
      .filter((plan) => plan.volumeId === volumeId)
      .sort((a, b) => b.submissionNo - a.submissionNo || b.createdAt - a.createdAt)
  }

  function planByNo(planNo: string): RepairPlan | undefined {
    return plans.value.find((plan) => plan.planNo === planNo)
  }

  function latestApprovalForVolumeKey(collectionNo: string, volumeNo: number): CommitteeApproval | null {
    return latestApproval(approvalsForVolumeKey(collectionNo, volumeNo))
  }

  function activeApprovalForVolumeKey(collectionNo: string, volumeNo: number): CommitteeApproval | null {
    return latestApprovedApproval(approvalsForVolumeKey(collectionNo, volumeNo))
  }

  function activeApprovalForVolumeId(volumeId: string): CommitteeApproval | null {
    const plan = plans.value.find((item) => item.volumeId === volumeId)
    if (!plan) return null
    return activeApprovalForVolumeKey(plan.collectionNo, plan.volumeNo)
  }

  function latestApprovalForPlan(planNo: string): CommitteeApproval | null {
    return latestApproval(approvals.value.filter((item) => item.planNo === planNo))
  }

  function isWithdrawable(approval: CommitteeApproval): boolean {
    if (approval.status !== 'approved' || approval.source !== 'committee') return false
    return latestApprovalForPlan(approval.planNo)?.id === approval.id
  }

  /** 同一方案单号被驳回 / 撤回后，修复室只重发本侧方案；工序不由委员会改动。 */
  async function resubmitPlan(planId: string, patch: Partial<RepairPlanDraft> = {}): Promise<RepairPlan> {
    const source = plans.value.find((plan) => plan.id === planId)
    if (!source) throw new Error('未找到要重发的方案')
    const latest = latestApprovalForPlan(source.planNo)
    if (latest && latest.status === 'approved') throw new Error('该方案已有生效同意批复，如级别变更请新建方案')
    const maxSubmissionNo = Math.max(...plans.value.filter((plan) => plan.planNo === source.planNo).map((plan) => plan.submissionNo))
    const now = Date.now()
    const row: RepairPlan = {
      ...source,
      ...patch,
      id: createId('plan'),
      planNo: source.planNo,
      submissionNo: maxSubmissionNo + 1,
      source: 'room',
      readOnly: false,
      submittedDate: dateStamp(),
      createdAt: now,
      updatedAt: now
    }
    await db.repairPlans.put(row)
    await loadCommitteeData()
    return row
  }

  async function createPlan(draft: RepairPlanDraft): Promise<RepairPlan> {
    if (!draft.planNo.trim()) throw new Error('请填写方案单号')
    if (plans.value.some((plan) => plan.planNo === draft.planNo && plan.submissionNo === draft.submissionNo)) {
      throw new Error('方案单号与提交次数已存在；驳回或撤回后请使用“重发”')
    }
    const now = Date.now()
    const row: RepairPlan = { ...draft, id: createId('plan'), createdAt: now, updatedAt: now }
    await db.repairPlans.put(row)
    await loadCommitteeData()
    return row
  }

  async function createApproval(draft: CommitteeApprovalDraft): Promise<CommitteeApproval> {
    if (!draft.approvalNo.trim()) throw new Error('请填写批复单号')
    if (!draft.planNo.trim()) throw new Error('请填写方案单号')
    if (draft.status === 'approved' && draft.decisionLevel === null) throw new Error('同意批复必须写明修复级别')
    const now = Date.now()
    const row: CommitteeApproval = { ...draft, id: createId('approval'), createdAt: now, updatedAt: now }
    await db.committeeApprovals.put(row)
    await loadCommitteeData()
    return row
  }

  /** 晚到批复以批复日期 / 登记时间决定生效次序；撤回追加委员会本侧新记录，不改修复室工序。 */
  async function withdrawApproval(id: string, opinion = ''): Promise<void> {
    const source = approvals.value.find((item) => item.id === id)
    if (!source) throw new Error('未找到批复记录')
    if (!isWithdrawable(source)) throw new Error('只有最新的委员会同意批复可以撤回')
    const withdrawalCount = approvals.value.filter(
      (item) => item.planNo === source.planNo && item.status === 'withdrawn'
    ).length
    const now = Date.now()
    const row: CommitteeApproval = {
      ...source,
      id: createId('approval'),
      approvalNo: `${source.approvalNo}-W${withdrawalCount + 1}`,
      status: 'withdrawn',
      decisionLevel: null,
      decidedDate: dateStamp(),
      opinion: opinion || '委员会撤回原批复',
      readOnly: true,
      createdAt: now,
      updatedAt: now
    }
    await db.committeeApprovals.put(row)
    await loadCommitteeData()
  }

  return {
    plans,
    approvals,
    loading,
    ready,
    error,
    loadCommitteeData,
    approvalsForVolumeKey,
    plansForVolume,
    planByNo,
    latestApprovalForVolumeKey,
    activeApprovalForVolumeKey,
    activeApprovalForVolumeId,
    latestApprovalForPlan,
    resubmitPlan,
    createPlan,
    createApproval,
    isWithdrawable,
    withdrawApproval
  }
})
