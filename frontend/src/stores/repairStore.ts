/**
 * 修复工序 store（Pinia setup store）
 * 维护工序顺序、拖拽重排落库重编号与完成态；完成即回写书叶状态。
 * 专家委员会批复生效后：级别管住后面的活——加固档只准补破、溜口，托裱 / 裁齐挡回；
 * 级别改了按晚到批复执行，但已完成工序不回退；驳回 / 撤回后工序照旧，只等修复室重发方案。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createId, db, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { createEmptyOrderDraft, type OrderState, type RepairOrder, type RepairOrderDraft } from '@/types/repairOrder'
import {
  APPROVAL_LEVEL_LABEL,
  isOrderAllowedByLevel,
  type ApprovalLevel
} from '@/types/approval'
import { isOrderBlocked as isOrderBlockedByLevel } from '@/utils/approval'
import { useLeafStore } from './leafStore'
import { useApprovalStore } from './approvalStore'

/** 取书叶所属册次当前生效的批复级别；无有效批复时为 null（该册只读） */
function levelOfLeaf(leafId: string): ApprovalLevel | null {
  const leafStore = useLeafStore()
  const approvalStore = useApprovalStore()
  const volumeId = leafStore.leafById(leafId)?.volumeId
  return volumeId ? approvalStore.levelOfVolume(volumeId) : null
}

/** 无批复 / 被当前级别挡住时的提示文案 */
export function orderBlockMessage(level: ApprovalLevel | null): string {
  if (!level) return '该册还没有生效的方案批复，动手前请先把方案报专家委员会批复'
  return `当前批复为「${APPROVAL_LEVEL_LABEL[level]}」档，这道工序不在批准范围内，已挡回`
}

export const useRepairStore = defineStore('repair', () => {
  const orders = ref<RepairOrder[]>([])
  const loading = ref(false)
  const ready = ref(false)
  const error = ref('')
  const sortMode = ref<'manual' | 'leaf'>(readUiPrefs().repairSort)

  const orderedOrders = computed<RepairOrder[]>(() =>
    [...orders.value].sort((a, b) =>
      a.leafId === b.leafId ? a.seq - b.seq : a.leafId.localeCompare(b.leafId)
    )
  )

  const totalSteps = computed<number>(() => orders.value.length)
  const doneSteps = computed<number>(() => orders.value.filter((order) => order.state === 'done').length)
  const donePercent = computed<number>(() =>
    orders.value.length === 0 ? 0 : Math.round((doneSteps.value / orders.value.length) * 100)
  )

  async function loadOrders(): Promise<void> {
    loading.value = true
    try {
      const rows = await db.repairOrders.toArray()
      rows.sort((a, b) => (a.leafId === b.leafId ? a.seq - b.seq : a.leafId.localeCompare(b.leafId)))
      orders.value = rows
      error.value = ''
      ready.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '工序读取失败'
    } finally {
      loading.value = false
    }
  }

  function ordersOfLeaf(leafId: string): RepairOrder[] {
    return orders.value.filter((order) => order.leafId === leafId).sort((a, b) => a.seq - b.seq)
  }

  /** 册次生效级别（无批复为 null），页面用来挂级别徽标与挡回提示 */
  function levelForLeaf(leafId: string): ApprovalLevel | null {
    return levelOfLeaf(leafId)
  }

  /**
   * 工序是否被当前批复级别挡住：
   * 已完成工序永不回退；未完成工序按晚到批复级别判定，无批复时一律只读。
   */
  function isBlocked(order: Pick<RepairOrder, 'leafId' | 'name' | 'state'>): boolean {
    if (order.state === 'done') return false
    return isOrderBlockedByLevel(order, levelOfLeaf(order.leafId))
  }

  function nextSeq(leafId: string): number {
    const list = orders.value.filter((order) => order.leafId === leafId)
    return list.length === 0 ? 1 : Math.max(...list.map((order) => order.seq)) + 1
  }

  async function createOrder(draft: RepairOrderDraft): Promise<RepairOrder> {
    // 批复级别管住后面的活：无批复只读，超级别工序当场挡回
    const level = levelOfLeaf(draft.leafId)
    if (!isOrderAllowedByLevelSafe(level, draft.name, draft.state)) {
      throw new Error(orderBlockMessage(level))
    }
    const now = Date.now()
    const row: RepairOrder = { ...draft, id: createId('order'), createdAt: now, updatedAt: now }
    await db.repairOrders.put(row)
    await loadOrders()
    return row
  }

  /** 新建 / 改工序名时的级别校验（已完成的不回退） */
  function isOrderAllowedByLevelSafe(
    level: ApprovalLevel | null,
    name: RepairOrderDraft['name'],
    state: RepairOrderDraft['state']
  ): boolean {
    if (state === 'done') return true
    return isOrderAllowedByLevel(level, name)
  }

  /** 按叶生成标准工序序列（补破 → 托裱 → 溜口 → 裁齐 → 压平）；受批复级别限制的工序不生成 */
  async function generateSequence(leafId: string): Promise<{ created: number; skipped: number }> {
    const level = levelOfLeaf(leafId)
    if (!level) throw new Error(orderBlockMessage(null))
    const existing = ordersOfLeaf(leafId)
    const occupied = new Set(existing.map((order) => order.seq))
    const names: RepairOrderDraft['name'][] = ['mend', 'mount', 'corner', 'trim', 'press']
    let created = 0
    let skipped = 0
    let seq = existing.length === 0 ? 0 : Math.max(...occupied)
    for (const name of names) {
      // 只补齐标准序列里尚未登记、且当前批复级别允许的工序
      if (occupied.has(names.indexOf(name) + 1)) continue
      if (!isOrderAllowedByLevel(level, name)) {
        skipped += 1
        continue
      }
      seq += 1
      const draft = createEmptyOrderDraft(leafId, seq)
      await db.repairOrders.put({
        ...draft,
        name,
        material: '',
        id: createId('order'),
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      created += 1
    }
    await loadOrders()
    return { created, skipped }
  }

  async function updateOrder(id: string, patch: Partial<RepairOrder>): Promise<void> {
    const current = orders.value.find((order) => order.id === id)
    if (current && current.state !== 'done') {
      const level = levelOfLeaf(current.leafId)
      // 改工序名或推进状态时按批复级别挡回；只改材料 / 操作人 / 日期等记录信息不拦
      const nameChanged = typeof patch.name === 'string' && patch.name !== current.name
      const stateChanged = typeof patch.state === 'string' && patch.state !== current.state
      if (nameChanged && !isOrderAllowedByLevel(level, patch.name as RepairOrderDraft['name'])) {
        throw new Error(orderBlockMessage(level))
      }
      if (stateChanged && !isOrderAllowedByLevel(level, current.name)) {
        throw new Error(orderBlockMessage(level))
      }
    }
    await db.repairOrders.update(id, { ...patch, updatedAt: Date.now() } as never)
    await loadOrders()
  }

  async function removeOrder(id: string): Promise<void> {
    const target = orders.value.find((order) => order.id === id)
    await db.repairOrders.delete(id)
    if (target) {
      const rest = orders.value
        .filter((order) => order.leafId === target.leafId && order.id !== id)
        .sort((a, b) => a.seq - b.seq)
        .map((order, index) => ({ ...order, seq: index + 1, updatedAt: Date.now() }))
      if (rest.length > 0) await db.repairOrders.bulkPut(rest)
    }
    await loadOrders()
  }

  async function batchUpdate(ids: string[], patch: Partial<RepairOrder>): Promise<number> {
    if (ids.length === 0) return 0
    const now = Date.now()
    // 级别挡回 + 已完成不回退：被挡的工序跳过，不做静默落库
    const rows = orders.value
      .filter((order) => ids.includes(order.id))
      .filter((order) => {
        // 已完成工序不回退；级别不允许的工序无论改成什么状态都挡回（已 done 的保持原状）
        if (order.state === 'done' && patch.state && patch.state !== 'done') return false
        const nextName = patch.name ?? order.name
        if (order.state !== 'done' && !isOrderAllowedByLevel(levelOfLeaf(order.leafId), nextName)) return false
        return true
      })
      .map((order) => ({ ...order, ...patch, updatedAt: now }))
    if (rows.length === 0) return 0
    await db.repairOrders.bulkPut(rows)
    await loadOrders()
    return rows.length
  }

  /** 拖拽重排：按新顺序落库并重编号 */
  async function reorderOrders(leafId: string, orderedIds: string[]): Promise<void> {
    const indexOf = new Map(orderedIds.map((id, index) => [id, index]))
    const rows = orders.value
      .filter((order) => order.leafId === leafId)
      .sort((a, b) => {
        const ai = indexOf.has(a.id) ? (indexOf.get(a.id) as number) : Number.MAX_SAFE_INTEGER
        const bi = indexOf.has(b.id) ? (indexOf.get(b.id) as number) : Number.MAX_SAFE_INTEGER
        return ai - bi
      })
      .map((order, index) => ({ ...order, seq: index + 1, updatedAt: Date.now() }))
    await db.repairOrders.bulkPut(rows)
    await loadOrders()
  }

  /** 推进工序状态；完成时回写书叶状态；批复级别不允许的工序一律挡回（已完成的才不回退） */
  async function advanceOrder(id: string): Promise<OrderState> {
    const order = orders.value.find((item) => item.id === id)
    if (!order) return 'todo'
    const flow: OrderState[] = ['todo', 'doing', 'done']
    const index = flow.indexOf(order.state)
    const next = index < 0 || index >= flow.length - 1 ? order.state : (flow[index + 1] as OrderState)
    if (next === order.state) return order.state
    // 托裱 / 裁齐被级别挡回时，既不能开工也不能标记完成；已经处于 done 的历史工序不动
    if (!isOrderAllowedByLevel(levelOfLeaf(order.leafId), order.name)) {
      throw new Error(orderBlockMessage(levelOfLeaf(order.leafId)))
    }
    await updateOrder(id, { state: next })
    if (next === 'done') {
      const leafStore = useLeafStore()
      const leaf = leafStore.leafById(order.leafId)
      if (leaf) {
        const siblings = ordersOfLeaf(order.leafId)
        const allDone = siblings.every((item) => item.state === 'done' || item.id === id)
        if (allDone) await leafStore.updateLeaf(leaf.id, { state: 'repaired' })
        else if (leaf.state === 'pending') await leafStore.updateLeaf(leaf.id, { state: 'repairing' })
      }
    } else if (next === 'doing') {
      const leafStore = useLeafStore()
      const leaf = leafStore.leafById(order.leafId)
      if (leaf && leaf.state === 'pending') await leafStore.updateLeaf(leaf.id, { state: 'repairing' })
    }
    return next
  }

  function setSortMode(mode: 'manual' | 'leaf'): void {
    sortMode.value = mode
    writeUiPrefs({ ...readUiPrefs(), repairSort: mode })
  }

  return {
    orders,
    orderedOrders,
    loading,
    ready,
    error,
    sortMode,
    totalSteps,
    doneSteps,
    donePercent,
    loadOrders,
    ordersOfLeaf,
    levelForLeaf,
    isBlocked,
    nextSeq,
    createOrder,
    generateSequence,
    updateOrder,
    removeOrder,
    batchUpdate,
    reorderOrders,
    advanceOrder,
    setSortMode
  }
})
