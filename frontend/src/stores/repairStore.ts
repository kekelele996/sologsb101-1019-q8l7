/**
 * 修复工序 store（Pinia setup store）
 * 维护工序顺序、拖拽重排落库重编号与完成态；完成即回写书叶状态。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createId, db, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { createEmptyOrderDraft, type OrderState, type RepairOrder, type RepairOrderDraft, type RepairName } from '@/types/repairOrder'
import { useLeafStore } from './leafStore'
import { useBookStore } from './bookStore'
import { useCommitteeStore } from './committeeStore'
import { gateRepairName } from '@/utils/approvalPolicy'
import type { CommitteeApproval } from '@/types/committeeApproval'

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

  function approvalsForLeaf(leafId: string): CommitteeApproval[] {
    const leafStore = useLeafStore()
    const bookStore = useBookStore()
    const committeeStore = useCommitteeStore()
    const leaf = leafStore.leaves.find((item) => item.id === leafId)
    const volume = leaf ? bookStore.volumes.find((item) => item.id === leaf.volumeId) : undefined
    const book = volume ? bookStore.books.find((item) => item.id === volume.bookId) : undefined
    if (!volume || !book) return []
    return committeeStore.approvalsForVolumeKey(book.collectionNo, volume.volumeNo)
  }

  function assertOrderAllowed(leafId: string, name: RepairName, alreadyDone = false): void {
    if (alreadyDone) return
    const gate = gateRepairName(approvalsForLeaf(leafId), name)
    if (!gate.allowed) throw new Error(gate.reason)
  }

  function nextSeq(leafId: string): number {
    const list = orders.value.filter((order) => order.leafId === leafId)
    return list.length === 0 ? 1 : Math.max(...list.map((order) => order.seq)) + 1
  }

  async function createOrder(draft: RepairOrderDraft): Promise<RepairOrder> {
    assertOrderAllowed(draft.leafId, draft.name, draft.state === 'done')
    const now = Date.now()
    const row: RepairOrder = { ...draft, id: createId('order'), createdAt: now, updatedAt: now }
    await db.repairOrders.put(row)
    await loadOrders()
    return row
  }

  /** 按叶生成标准工序序列；只生成当前批复档级允许的工序（补破 / 托裱 / 溜口 / 裁齐 / 压平） */
  async function generateSequence(leafId: string): Promise<number> {
    const existing = ordersOfLeaf(leafId)
    const standardNames: RepairName[] = ['mend', 'mount', 'corner', 'trim', 'press']
    const allowedNames = standardNames.filter((name) => {
      const gate = gateRepairName(approvalsForLeaf(leafId), name)
      return gate.allowed
    })
    if (allowedNames.length === 0) {
      throw new Error(gateRepairName(approvalsForLeaf(leafId), 'mend').reason)
    }
    const usedNames = new Set(existing.map((order) => order.name))
    let created = 0
    let seq = existing.length === 0 ? 0 : Math.max(...existing.map((order) => order.seq))
    for (const name of allowedNames) {
      if (usedNames.has(name)) continue
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
    return created
  }

  async function updateOrder(id: string, patch: Partial<RepairOrder>): Promise<void> {
    const existing = orders.value.find((order) => order.id === id)
    if (existing) {
      const nextName = patch.name ?? existing.name
      if (existing.state === 'done' && nextName !== existing.name) {
        throw new Error('已完成工序不回退，也不能改成其他工序')
      }
      if (existing.state !== 'done') assertOrderAllowed(existing.leafId, nextName)
    }
    await db.repairOrders.update(id, { ...patch, updatedAt: Date.now() } as never)
    await loadOrders()
  }

  async function removeOrder(id: string): Promise<void> {
    const target = orders.value.find((order) => order.id === id)
    if (target) {
      if (target.state === 'done') throw new Error('已完成工序不回退、不删除，将作为历史记录保留')
      const gate = gateRepairName(approvalsForLeaf(target.leafId), target.name)
      if (!gate.allowed) throw new Error(gate.reason)
    }
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

  async function batchUpdate(ids: string[], patch: Partial<RepairOrder>): Promise<void> {
    if (ids.length === 0) return
    const targets = orders.value.filter((order) => ids.includes(order.id))
    targets.forEach((order) => {
      assertOrderAllowed(order.leafId, patch.name ?? order.name, order.state === 'done')
    })
    const now = Date.now()
    const rows = orders.value.filter((order) => ids.includes(order.id)).map((order) => ({ ...order, ...patch, updatedAt: now }))
    await db.repairOrders.bulkPut(rows)
    await loadOrders()
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

  /** 推进工序状态；完成时回写书叶状态 */
  async function advanceOrder(id: string): Promise<OrderState> {
    const order = orders.value.find((item) => item.id === id)
    if (!order) return 'todo'
    const flow: OrderState[] = ['todo', 'doing', 'done']
    const index = flow.indexOf(order.state)
    const next = index < 0 || index >= flow.length - 1 ? order.state : (flow[index + 1] as OrderState)
    if (next === order.state) return order.state
    if (order.state !== 'done') assertOrderAllowed(order.leafId, order.name)
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
