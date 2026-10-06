<script setup lang="ts">
/**
 * /committee 专家委员会批复台账
 * 修复室上报方案与委员会批复各记各的；按方案单号、收藏号、册次号对账。
 * 批复级别不在本页改写工序，由修复工序页读取最新“同意”批复后约束后续操作。
 */
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshLeft, Stamp } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { useFilterQuery, type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useBookStore } from '@/stores/bookStore'
import { useCommitteeStore } from '@/stores/committeeStore'
import {
  REPAIR_LEVEL_COLOR,
  REPAIR_LEVEL_LABEL,
  REPAIR_LEVEL_OPTIONS,
  createEmptyPlanDraft,
  type RepairPlan,
  type RepairPlanDraft,
  type RepairLevel
} from '@/types/repairPlan'
import {
  APPROVAL_STATUS_COLOR,
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_OPTIONS,
  APPROVAL_SOURCE_LABEL,
  createEmptyApprovalDraft,
  type CommitteeApproval,
  type CommitteeApprovalDraft,
  type ApprovalStatus
} from '@/types/committeeApproval'
import { REPAIR_PLAN_SOURCE_LABEL } from '@/types/repairPlan'

const bookStore = useBookStore()
const committeeStore = useCommitteeStore()
const FILTER_KEYS = ['level', 'status'] as const
const url = useFilterQuery(FILTER_KEYS)

const volumeOptions = computed(() =>
  bookStore.books.flatMap((book) =>
    bookStore.volumesOfBook(book.id).map((volume) => ({
      value: volume.id,
      label: `《${book.title}》第 ${volume.volumeNo} 册 · 收藏号 ${book.collectionNo || '未编'}`,
      book,
      volume
    }))
  )
)

const filterModel = computed<FilterModel>(() => ({
  keyword: url.keyword.value,
  level: url.values.value.level ?? [],
  status: url.values.value.status ?? []
}))

const filterSelects = [
  { key: 'level', label: '修复级别', options: REPAIR_LEVEL_OPTIONS.map((item) => ({ label: item.label, value: item.value })) },
  { key: 'status', label: '批复状态', options: APPROVAL_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })) }
]

function handleFilterChange(next: FilterModel): void {
  url.apply({
    kw: typeof next.keyword === 'string' ? next.keyword : '',
    level: (next.level as string[]) ?? [],
    status: (next.status as string[]) ?? []
  })
}

const filteredPlans = computed(() => {
  const keyword = url.keyword.value.trim()
  const levels = url.values.value.level ?? []
  return committeeStore.plans.filter((plan) => {
    if (levels.length > 0 && !levels.includes(plan.proposedLevel)) return false
    if (keyword.length > 0) {
      const haystack = `${plan.planNo}${plan.bookTitle}${plan.collectionNo}${plan.submitter}${plan.remark}`
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
})

const filteredApprovals = computed(() => {
  const keyword = url.keyword.value.trim()
  const levels = url.values.value.level ?? []
  const statuses = url.values.value.status ?? []
  return committeeStore.approvals.filter((approval) => {
    if (levels.length > 0 && approval.decisionLevel && !levels.includes(approval.decisionLevel)) return false
    if (statuses.length > 0 && !statuses.includes(approval.status)) return false
    if (keyword.length > 0) {
      const haystack = `${approval.approvalNo}${approval.planNo}${approval.bookTitle}${approval.collectionNo}${approval.reviewer}${approval.opinion}`
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
})

const stats = computed(() => {
  const approved = committeeStore.approvals.filter((item) => item.status === 'approved')
  return {
    plans: committeeStore.plans.length,
    approvals: committeeStore.approvals.length,
    approved: approved.length,
    rejected: committeeStore.approvals.filter((item) => item.status === 'rejected').length,
    withdrawn: committeeStore.approvals.filter((item) => item.status === 'withdrawn').length,
    reinforce: approved.filter((item) => item.decisionLevel === 'reinforce').length
  }
})

function levelLabel(level: RepairLevel | null | undefined): string {
  return level ? REPAIR_LEVEL_LABEL[level] : '—'
}
function levelColor(level: RepairLevel | null | undefined): string {
  return level ? REPAIR_LEVEL_COLOR[level] : '#8c8c8c'
}
function statusLabel(status: ApprovalStatus): string {
  return APPROVAL_STATUS_LABEL[status]
}
function statusColor(status: ApprovalStatus): string {
  return APPROVAL_STATUS_COLOR[status]
}

function latestStatus(plan: RepairPlan): ApprovalStatus | null {
  return committeeStore.latestApprovalForPlan(plan.planNo)?.status ?? null
}

/* ----------------------------- 修复室方案 ----------------------------- */
const planDialog = ref(false)
const planForm = reactive<RepairPlanDraft>(createEmptyPlanDraft({
  id: '',
  bookId: '',
  bookTitle: '',
  collectionNo: '',
  volumeNo: 1
}))
const selectedVolumeId = ref('')

function nextPlanNo(): string {
  const year = new Date().getFullYear()
  const serial = String(committeeStore.plans.length + 1).padStart(4, '0')
  return `FA-${year}-${serial}`
}

function handleVolumeChange(volumeId: string): void {
  const option = volumeOptions.value.find((item) => item.value === volumeId)
  if (!option) return
  Object.assign(
    planForm,
    createEmptyPlanDraft({
      id: option.volume.id,
      bookId: option.book.id,
      bookTitle: option.book.title,
      collectionNo: option.book.collectionNo,
      volumeNo: option.volume.volumeNo
    }),
    { planNo: nextPlanNo() }
  )
}

function openPlanDialog(): void {
  const first = volumeOptions.value[0]
  if (!first) {
    ElMessage.warning('请先在修复室登记古籍与册次')
    return
  }
  selectedVolumeId.value = first.value
  handleVolumeChange(first.value)
  planDialog.value = true
}

async function submitPlan(): Promise<void> {
  if (!planForm.volumeId || !planForm.planNo.trim()) {
    ElMessage.warning('请选择册次并填写方案单号')
    return
  }
  try {
    await committeeStore.createPlan({ ...planForm })
    ElMessage.success('修复室方案已上报，委员会可登记批复')
    planDialog.value = false
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '方案上报失败')
  }
}

async function resend(plan: RepairPlan): Promise<void> {
  try {
    await ElMessageBox.confirm('驳回或撤回后仅重发修复室本侧方案单；已登记工序保持原样，不做回退。', '重发方案', {
      type: 'warning',
      confirmButtonText: '确认重发',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await committeeStore.resubmitPlan(plan.id, {
      proposedLevel: plan.proposedLevel,
      remark: `${plan.remark}（驳回 / 撤回后重发）`.trim()
    })
    ElMessage.success('已按原方案单号重发，提交次数递增')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '重发失败')
  }
}

/* ----------------------------- 委员会批复 ----------------------------- */
const approvalDialog = ref(false)
const approvalForm = reactive<CommitteeApprovalDraft>(createEmptyApprovalDraft())

function nextApprovalNo(): string {
  const year = new Date().getFullYear()
  const serial = String(committeeStore.approvals.length + 1).padStart(4, '0')
  return `PF-${year}-${serial}`
}

function openApprovalDialog(plan?: RepairPlan): void {
  Object.assign(approvalForm, createEmptyApprovalDraft(), { approvalNo: nextApprovalNo() })
  if (plan) fillApprovalFromPlan(plan)
  approvalDialog.value = true
}

function fillApprovalFromPlan(plan: RepairPlan): void {
  Object.assign(approvalForm, {
    planNo: plan.planNo,
    planId: plan.id,
    decisionLevel: plan.proposedLevel,
    collectionNo: plan.collectionNo,
    volumeNo: plan.volumeNo,
    volumeId: plan.volumeId,
    bookTitle: plan.bookTitle
  })
}

function handleApprovalPlanChange(planId: string): void {
  const plan = committeeStore.plans.find((item) => item.id === planId)
  if (plan) fillApprovalFromPlan(plan)
}

async function submitApproval(): Promise<void> {
  if (approvalForm.status === 'approved' && approvalForm.decisionLevel === null) {
    ElMessage.warning('同意批复必须写明全面修复、局部修复或加固')
    return
  }
  try {
    await committeeStore.createApproval({
      ...approvalForm,
      decisionLevel: approvalForm.status === 'approved' ? approvalForm.decisionLevel : null
    })
    ElMessage.success('委员会批复已登记；后续工序将按最晚的同意批复执行')
    approvalDialog.value = false
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '批复登记失败')
  }
}

async function withdraw(approval: CommitteeApproval): Promise<void> {
  try {
    await ElMessageBox.confirm('将追加一条“撤回”批复；修复室需重发方案，已完成工序不回退。', '撤回批复', {
      type: 'warning',
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await committeeStore.withdrawApproval(approval.id)
    ElMessage.success('已登记撤回批复')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '撤回失败')
  }
}
</script>

<template>
  <div>
    <div class="gb-page-head">
      <div>
        <h2>专家委员会批复</h2>
        <p>修复室先报方案，委员会按方案单号和册次号登记批复；两侧各记各的，靠收藏号与册次号对账。</p>
      </div>
      <div class="gb-toolbar">
        <el-button :icon="RefreshLeft" @click="openPlanDialog">修复室上报方案</el-button>
        <el-button type="primary" :icon="Stamp" @click="openApprovalDialog()">委员会登记批复</el-button>
      </div>
    </div>

    <div class="gb-stat-row">
      <StatBadge label="方案单" :value="stats.plans" suffix="份" tone="primary" />
      <StatBadge label="批复记录" :value="stats.approvals" suffix="条" tone="info" />
      <StatBadge label="同意批复" :value="stats.approved" suffix="条" tone="success" />
      <StatBadge label="驳回" :value="stats.rejected" suffix="条" tone="danger" />
      <StatBadge label="撤回" :value="stats.withdrawn" suffix="条" />
      <StatBadge label="加固档在册" :value="stats.reinforce" suffix="条" tone="warning" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="搜索单号 / 书名 / 收藏号 / 经办人…"
      @change="handleFilterChange"
      @reset="url.reset()"
    />

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :xl="11">
        <el-card shadow="never">
          <template #header>
            <strong>修复室方案（本侧台账）</strong>
          </template>
          <EmptyPanel
            v-if="filteredPlans.length === 0"
            title="暂无修复方案"
            description="每册动手前先上报方案；驳回或撤回后按原单号重发本侧方案单。"
            action-text="上报方案"
            size="small"
            @action="openPlanDialog"
          />
          <el-table v-else :data="filteredPlans" size="small" border>
            <el-table-column label="方案单号 / 次" min-width="145">
              <template #default="{ row }">
                <strong>{{ row.planNo }}</strong>
                <div class="gb-muted">第 {{ row.submissionNo }} 次 · {{ REPAIR_PLAN_SOURCE_LABEL[row.source as keyof typeof REPAIR_PLAN_SOURCE_LABEL] }}</div>
              </template>
            </el-table-column>
            <el-table-column label="册次" min-width="160">
              <template #default="{ row }">
                《{{ row.bookTitle }}》第 {{ row.volumeNo }} 册
                <div class="gb-muted">{{ row.collectionNo || '收藏号未编' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="申请级别" width="100">
              <template #default="{ row }">
                <el-tag :style="{ color: levelColor(row.proposedLevel), borderColor: `${levelColor(row.proposedLevel)}66` }" effect="plain" round>
                  {{ levelLabel(row.proposedLevel) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="批复" width="90">
              <template #default="{ row }">
                <el-tag v-if="latestStatus(row)" :style="{ color: statusColor(latestStatus(row) as ApprovalStatus) }" effect="plain" round>
                  {{ statusLabel(latestStatus(row) as ApprovalStatus) }}
                </el-tag>
                <span v-else class="gb-muted">待批复</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="openApprovalDialog(row)">批复</el-button>
                <el-button
                  v-if="latestStatus(row) === 'rejected' || latestStatus(row) === 'withdrawn'"
                  size="small"
                  text
                  type="warning"
                  @click="resend(row)"
                >
                  重发
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :xs="24" :xl="13">
        <el-card shadow="never">
          <template #header>
            <strong>委员会批复（独立登记）</strong>
          </template>
          <EmptyPanel
            v-if="filteredApprovals.length === 0"
            title="暂无批复记录"
            description="同意时写明全面修复、局部修复或加固；晚到的同意批复改变后续级别，已完成工序不回退。"
            action-text="登记批复"
            size="small"
            @action="openApprovalDialog()"
          />
          <el-table v-else :data="filteredApprovals" size="small" border>
            <el-table-column label="批复 / 方案单号" min-width="165">
              <template #default="{ row }">
                <strong>{{ row.approvalNo }}</strong>
                <div class="gb-muted">{{ row.planNo }} · {{ APPROVAL_SOURCE_LABEL[row.source as keyof typeof APPROVAL_SOURCE_LABEL] }}</div>
              </template>
            </el-table-column>
            <el-table-column label="册次对账" min-width="150">
              <template #default="{ row }">
                {{ row.collectionNo || '收藏号未编' }} · 第 {{ row.volumeNo }} 册
                <div class="gb-muted">{{ row.bookTitle || '未匹配修复室古籍' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态 / 级别" width="120">
              <template #default="{ row }">
                <el-tag :style="{ color: statusColor(row.status), borderColor: `${statusColor(row.status)}66` }" effect="plain" round>
                  {{ statusLabel(row.status) }}
                </el-tag>
                <el-tag
                  v-if="row.decisionLevel"
                  :style="{ color: levelColor(row.decisionLevel), borderColor: `${levelColor(row.decisionLevel)}66`, marginTop: '4px' }"
                  effect="plain"
                  round
                >
                  {{ levelLabel(row.decisionLevel) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reviewer" label="经办人" width="110" />
            <el-table-column prop="decidedDate" label="日期" width="110" />
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button
                  v-if="committeeStore.isWithdrawable(row)"
                  size="small"
                  text
                  type="danger"
                  @click="withdraw(row)"
                >
                  撤回
                </el-button>
                <span v-else class="gb-muted">只读</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="planDialog" title="修复室上报方案" width="560px">
      <el-form label-width="100px">
        <el-form-item label="册次" required>
          <el-select v-model="selectedVolumeId" filterable style="width: 100%" @change="handleVolumeChange">
            <el-option v-for="item in volumeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="方案单号" required>
          <el-input v-model="planForm.planNo" placeholder="如：FA-2026-0001" />
        </el-form-item>
        <el-form-item label="申请级别" required>
          <el-select v-model="planForm.proposedLevel" style="width: 100%">
            <el-option v-for="item in REPAIR_LEVEL_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="上报人">
          <el-input v-model="planForm.submitter" placeholder="如：沈玉" />
        </el-form-item>
        <el-form-item label="上报日期">
          <el-input v-model="planForm.submittedDate" type="date" />
        </el-form-item>
        <el-form-item label="方案说明">
          <el-input v-model="planForm.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planDialog = false">取消</el-button>
        <el-button type="primary" @click="submitPlan">上报</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="approvalDialog" title="委员会登记批复" width="600px">
      <el-form label-width="100px">
        <el-form-item label="修复室方案">
          <el-select v-model="approvalForm.planId" clearable filterable placeholder="可选；手工登记时留空" style="width: 100%" @change="handleApprovalPlanChange">
            <el-option v-for="plan in committeeStore.plans" :key="plan.id" :label="`${plan.planNo}（第${plan.submissionNo}次）· 《${plan.bookTitle}》第${plan.volumeNo}册`" :value="plan.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="批复单号" required>
          <el-input v-model="approvalForm.approvalNo" placeholder="如：PF-2026-0001" />
        </el-form-item>
        <el-form-item label="方案单号" required>
          <el-input v-model="approvalForm.planNo" placeholder="与修复室方案单号对账" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="收藏号">
              <el-input v-model="approvalForm.collectionNo" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="册次号" required>
              <el-input-number v-model="approvalForm.volumeNo" :min="1" :max="999" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="批复结果" required>
          <el-select v-model="approvalForm.status" style="width: 100%">
            <el-option v-for="item in APPROVAL_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="approvalForm.status === 'approved'" label="修复级别" required>
          <el-select v-model="approvalForm.decisionLevel" style="width: 100%">
            <el-option v-for="item in REPAIR_LEVEL_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="经办人">
          <el-input v-model="approvalForm.reviewer" placeholder="专家委员会经办人" />
        </el-form-item>
        <el-form-item label="批复日期">
          <el-input v-model="approvalForm.decidedDate" type="date" />
        </el-form-item>
        <el-form-item label="批复意见">
          <el-input v-model="approvalForm.opinion" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <el-alert
        v-if="approvalForm.status === 'approved' && approvalForm.decisionLevel === 'reinforce'"
        type="warning"
        show-icon
        :closable="false"
        title="加固档只准补破和溜口；托裱、裁齐、压平在修复室会被挡回。"
      />
      <template #footer>
        <el-button @click="approvalDialog = false">取消</el-button>
        <el-button type="primary" @click="submitApproval">保存批复</el-button>
      </template>
    </el-dialog>
  </div>
</template>
