<script setup lang="ts">
/**
 * /approvals 修复方案批复（专家委员会侧）
 * 按方案单号 + 册次号登记批复：全面修复 / 局部修复 / 加固。
 * 本页只登记委员会侧记录，不触碰古籍 / 册次 / 工序；与修复室靠册次号对账。
 * 级别改了按晚到那份批复往下走（已完成工序不回退）；驳回 / 撤回后修复室只重发本侧方案单。
 * 消费 RepairApproval（对账 Volume / Book）；复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { computed, reactive, ref, watchEffect } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, RefreshRight } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { useFilterQuery, type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useBookStore } from '@/stores/bookStore'
import { useApprovalStore } from '@/stores/approvalStore'
import {
  APPROVAL_LEVEL_COLOR,
  APPROVAL_LEVEL_LABEL,
  APPROVAL_LEVEL_OPTIONS,
  APPROVAL_STATUS_COLOR,
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_OPTIONS,
  createEmptyApprovalDraft,
  type ApprovalLevel,
  type ApprovalStatus,
  type RepairApproval,
  type RepairApprovalDraft
} from '@/types/approval'

const bookStore = useBookStore()
const approvalStore = useApprovalStore()

const FILTER_KEYS = ['level', 'status'] as const
const url = useFilterQuery(FILTER_KEYS)

const filterModel = computed<FilterModel>(() => ({
  keyword: url.keyword.value,
  level: url.values.value.level ?? [],
  status: url.values.value.status ?? []
}))

const filterSelects = [
  { key: 'level', label: '批复级别', options: APPROVAL_LEVEL_OPTIONS.map((item) => ({ label: item.label, value: item.value })) },
  { key: 'status', label: '批复状态', options: APPROVAL_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })) }
]

function handleFilterChange(next: FilterModel): void {
  url.apply({
    kw: typeof next.keyword === 'string' ? next.keyword : '',
    level: (next.level as string[]) ?? [],
    status: (next.status as string[]) ?? []
  })
}

const volumeOptions = computed(() =>
  bookStore.books.flatMap((book) =>
    bookStore.volumesOfBook(book.id).map((volume) => ({
      value: volume.id,
      label: `《${book.title}》第 ${volume.volumeNo} 册`
    }))
  )
)

function volumeText(volumeId: string): string {
  const volume = bookStore.volumeById(volumeId)
  if (!volume) return '册次已删除'
  const book = bookStore.bookById(volume.bookId)
  return `${book ? `《${book.title}》` : ''}第 ${volume.volumeNo} 册`
}

function nextPlanNo(): string {
  const year = new Date().getFullYear()
  const seq = String(approvalStore.totalCount + 1).padStart(4, '0')
  return `FA-${year}-${seq}`
}

const rows = computed<RepairApproval[]>(() => {
  const keyword = url.keyword.value.trim()
  const levels = url.values.value.level ?? []
  const statuses = url.values.value.status ?? []
  return approvalStore.approvals.filter((item) => {
    if (keyword.length > 0) {
      const haystack = `${item.planNo}${item.opinion}${item.approver}${volumeText(item.volumeId)}`
      if (!haystack.includes(keyword)) return false
    }
    if (levels.length > 0 && !levels.includes(item.level)) return false
    if (statuses.length > 0 && !statuses.includes(item.status)) return false
    return true
  })
})

const stat = computed(() => {
  const decided = new Set(
    bookStore.volumes
      .map((volume) => approvalStore.effectiveOfVolume(volume.id))
      .filter((item): item is RepairApproval => item !== null)
      .map((item) => item.volumeId)
  )
  return {
    total: approvalStore.totalCount,
    effectiveVolumes: decided.size,
    rejected: approvalStore.approvals.filter((item) => item.status === 'rejected').length,
    withdrawn: approvalStore.approvals.filter((item) => item.status === 'withdrawn').length,
    pendingVolumes: bookStore.volumes.filter((volume) => !approvalStore.effectiveOfVolume(volume.id)).length
  }
})

/** 标记该行是否为其册次当前生效的批复 */
function isEffective(row: RepairApproval): boolean {
  return approvalStore.effectiveOfVolume(row.volumeId)?.id === row.id
}

/* ----------------------------- 批复表单 ----------------------------- */
const dialog = ref(false)
const editing = ref<RepairApproval | null>(null)
const form = reactive<RepairApprovalDraft>(createEmptyApprovalDraft('', ''))

function openCreate(volumeId = ''): void {
  const first = volumeId || volumeOptions.value[0]?.value || ''
  editing.value = null
  Object.assign(form, createEmptyApprovalDraft(first, nextPlanNo()))
  dialog.value = true
}

function openEdit(row: RepairApproval): void {
  editing.value = row
  Object.assign(form, {
    planNo: row.planNo,
    volumeId: row.volumeId,
    level: row.level,
    status: row.status,
    opinion: row.opinion,
    approver: row.approver,
    decidedAt: row.decidedAt,
    historical: row.historical
  })
  dialog.value = true
}

/** 驳回 / 撤回后修复室只重发本侧方案单：按同册次登记一份新批复 */
function reopen(row: RepairApproval): void {
  editing.value = null
  Object.assign(form, createEmptyApprovalDraft(row.volumeId, nextPlanNo()))
  dialog.value = true
  ElMessage.info('已带出席次，登记修复室重发方案后的新批复；旧记录留痕不删。')
}

async function submit(): Promise<void> {
  if (!form.volumeId) {
    ElMessage.warning('请选择对账册次')
    return
  }
  if (form.planNo.trim().length === 0) {
    ElMessage.warning('请填写方案单号')
    return
  }
  if (editing.value) {
    await approvalStore.updateApproval(editing.value.id, { ...form })
    ElMessage.success('批复已更新')
  } else {
    await approvalStore.createApproval({ ...form, planNo: form.planNo.trim() })
    ElMessage.success(
      form.status === 'approved'
        ? `已登记批复：${APPROVAL_LEVEL_LABEL[form.level]}，修复室即刻按此级别施工`
        : '已登记，修复室将重发本侧方案单；在办工序照旧不回退'
    )
  }
  dialog.value = false
}

async function remove(row: RepairApproval): Promise<void> {
  try {
    await ElMessageBox.confirm('仅删除委员会侧这条批复登记，修复室的古籍册次与工序不受影响。', '删除批复记录', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  await approvalStore.removeApproval(row.id)
  ElMessage.success('已删除该批复')
}

function levelLabel(level: string): string {
  return APPROVAL_LEVEL_LABEL[level as ApprovalLevel] ?? level
}

function levelColor(level: string): string {
  return APPROVAL_LEVEL_COLOR[level as ApprovalLevel] ?? '#6b6257'
}

function statusLabel(status: string): string {
  return APPROVAL_STATUS_LABEL[status as ApprovalStatus] ?? status
}

function statusColor(status: string): string {
  return APPROVAL_STATUS_COLOR[status as ApprovalStatus] ?? '#6b6257'
}

watchEffect(() => {
  // 筛选条件变化时列表自动重算（URL 为唯一事实来源）
  void url.keyword.value
  void url.values.value
})
</script>

<template>
  <div>
    <div class="gb-page-head">
      <div>
        <h2>修复方案批复 · 专家委员会</h2>
        <p>
          每册动手前先报方案；委员会按方案单号与册次号登记批复（全面 / 局部 / 加固）。两边各记各的，靠册次号对账，
          批复级别管住修复室后续工序。
        </p>
      </div>
      <div class="gb-toolbar">
        <el-button type="primary" :icon="Plus" @click="openCreate()">登记批复</el-button>
      </div>
    </div>

    <div class="gb-stat-row">
      <StatBadge label="批复记录" :value="stat.total" suffix="份" tone="primary" />
      <StatBadge label="已生效册次" :value="stat.effectiveVolumes" suffix="册" tone="success" />
      <StatBadge label="待批复册次" :value="stat.pendingVolumes" suffix="册" tone="warning" />
      <StatBadge label="驳回" :value="stat.rejected" suffix="份" tone="danger" />
      <StatBadge label="撤回" :value="stat.withdrawn" suffix="份" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="搜索方案单号 / 批复人 / 意见 / 册次…"
      @change="handleFilterChange"
      @reset="url.reset()"
    />

    <el-card shadow="never" style="margin-top: 16px">
      <EmptyPanel
        v-if="rows.length === 0"
        :title="approvalStore.totalCount === 0 ? '还没有方案批复' : '当前筛选条件下没有批复'"
        :description="
          approvalStore.totalCount === 0
            ? '修复室每册动手前先报方案；委员会在此按方案单号与册次号登记全面修复、局部修复或加固。'
            : '试着调整级别或状态筛选条件。'
        "
        action-text="登记批复"
        secondary-text="重置筛选"
        size="small"
        @action="openCreate()"
        @secondary="url.reset()"
      />

      <el-table v-else :data="rows" size="small" border>
        <el-table-column prop="planNo" label="方案单号" width="160" sortable />
        <el-table-column label="对账册次" min-width="190">
          <template #default="{ row }">
            <span>{{ volumeText(row.volumeId) }}</span>
            <el-tag v-if="isEffective(row)" type="success" size="small" effect="plain" round style="margin-left: 6px">
              当前生效
            </el-tag>
            <el-tag v-else-if="row.status === 'approved'" size="small" effect="plain" round style="margin-left: 6px">
              已被晚到批复替代
            </el-tag>
            <el-tag v-if="row.historical" type="info" size="small" effect="plain" round style="margin-left: 6px">
              历史回填
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="100">
          <template #default="{ row }">
            <el-tag :style="{ color: levelColor(row.level), borderColor: `${levelColor(row.level)}66` }" effect="plain" round>
              {{ levelLabel(row.level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :style="{ color: statusColor(row.status), borderColor: `${statusColor(row.status)}66` }" effect="plain" round>
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="decidedAt" label="批复日期" width="115" sortable />
        <el-table-column prop="approver" label="批复人" width="100">
          <template #default="{ row }">{{ row.approver || '—' }}</template>
        </el-table-column>
        <el-table-column prop="opinion" label="批复意见" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.opinion || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'approved'"
              size="small"
              text
              type="success"
              :icon="RefreshRight"
              @click="reopen(row)"
            >
              重发后登记
            </el-button>
            <el-button size="small" text :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-alert
        type="info"
        show-icon
        :closable="false"
        style="margin-top: 10px"
        title="两侧各记各的：委员会只登记方案单与批复，修复室照旧管古籍、册次与逐道工序。"
        description="加固档修复室只准补破、溜口，托裱与裁齐当场挡回；级别改动按批复日期晚到的那份执行，已完成的工序不回退；驳回或撤回后修复室只重发本侧方案单，工序照旧。"
      />
    </el-card>

    <el-dialog v-model="dialog" :title="editing ? '编辑方案批复' : '登记方案批复'" width="560px">
      <el-form label-width="96px">
        <el-form-item label="对账册次" required>
          <el-select v-model="form.volumeId" filterable :disabled="editing !== null" style="width: 100%">
            <el-option v-for="item in volumeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="方案单号" required>
          <el-input v-model="form.planNo" placeholder="如：FA-2026-0017" />
        </el-form-item>
        <el-form-item label="批复级别" required>
          <el-radio-group v-model="form.level">
            <el-radio-button v-for="item in APPROVAL_LEVEL_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="批复状态" required>
          <el-radio-group v-model="form.status">
            <el-radio-button v-for="item in APPROVAL_STATUS_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="批复日期">
          <el-input v-model="form.decidedAt" type="date" />
        </el-form-item>
        <el-form-item label="批复人">
          <el-input v-model="form.approver" placeholder="如：顾延年" />
        </el-form-item>
        <el-form-item label="批复意见">
          <el-input v-model="form.opinion" type="textarea" :rows="3" placeholder="级别约束、最小干预要求等" />
        </el-form-item>
      </el-form>
      <el-alert
        v-if="form.status === 'approved'"
        :type="form.level === 'reinforce' ? 'warning' : 'success'"
        show-icon
        :closable="false"
        :title="
          form.level === 'reinforce'
            ? '加固档：修复室只准补破、溜口，托裱、裁齐将被挡回'
            : `批复后修复室按「${levelLabel(form.level)}」施工；晚到的批复自动覆盖早先级别`
        "
        description="已完成的工序不因级别变化回退。"
      />
      <el-alert
        v-else
        type="error"
        show-icon
        :closable="false"
        title="驳回 / 撤回不产生有效批复：修复室只重发本侧方案单，在办工序照旧、不回退。"
      />
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
