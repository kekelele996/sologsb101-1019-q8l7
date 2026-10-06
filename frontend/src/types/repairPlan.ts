/**
 * 修复方案上报单（RepairPlan）数据模型
 * 属于修复室上下文：只记录本室古籍、册次与拟申请修复级别。
 * 委员会批复不直接写回本模型；两侧通过方案单号、收藏号与册次号对账。
 */

/** 批复修复级别：全面修复 / 局部修复 / 加固 */
export type RepairLevel = 'full' | 'partial' | 'reinforce';

/** 方案来源：修复室上报 / 升级时按历史进度回填 */
export type RepairPlanSource = 'room' | 'history';

export interface RepairPlan {
  id: string;
  /** 方案单号；驳回或撤回后重发沿用同一单号，提交次数递增 */
  planNo: string;
  /** 同一单号第几次上报，从 1 开始 */
  submissionNo: number;
  /** 修复室申请级别 */
  proposedLevel: RepairLevel;
  /** 修复室侧册次主键 */
  volumeId: string;
  /** 冗余古籍 id，便于跨表查询 */
  bookId: string;
  /** 冗余书名，仅作台账展示 */
  bookTitle: string;
  /** 收藏号；与册次号共同作为人工对账线索 */
  collectionNo: string;
  /** 册次号（对账字段，不使用册次主键替代） */
  volumeNo: number;
  /** 上报人 */
  submitter: string;
  /** 上报日期 yyyy-MM-dd */
  submittedDate: string;
  /** 方案说明 */
  remark: string;
  source: RepairPlanSource;
  /** 历史回填或无法对账的记录只读 */
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RepairPlanDraft = Omit<RepairPlan, 'id' | 'createdAt' | 'updatedAt'>;

export const REPAIR_LEVEL_LABEL: Record<RepairLevel, string> = {
  full: '全面修复',
  partial: '局部修复',
  reinforce: '加固'
};

export const REPAIR_LEVEL_COLOR: Record<RepairLevel, string> = {
  full: '#b03a2e',
  partial: '#d68910',
  reinforce: '#3a6ea5'
};

export const REPAIR_LEVEL_OPTIONS: ReadonlyArray<{ value: RepairLevel; label: string }> = [
  { value: 'full', label: '全面修复' },
  { value: 'partial', label: '局部修复' },
  { value: 'reinforce', label: '加固' }
];

export const REPAIR_PLAN_SOURCE_LABEL: Record<RepairPlanSource, string> = {
  room: '修复室上报',
  history: '历史回填'
};

/** 加固档允许的工序：补破、溜口；托裱、裁齐、压平一律挡回 */
export const REPAIR_LEVEL_ORDER_LIMIT: Record<RepairLevel, string> = {
  full: '补破、托裱、溜口、裁齐、压平均可',
  partial: '允许补破、溜口、压平；不得托裱、裁齐',
  reinforce: '只允许补破、溜口；托裱、裁齐、压平一律挡回'
};

export function createEmptyPlanDraft(volume: {
  id: string;
  bookId: string;
  bookTitle: string;
  collectionNo: string;
  volumeNo: number;
}): RepairPlanDraft {
  return {
    planNo: '',
    submissionNo: 1,
    proposedLevel: 'partial',
    volumeId: volume.id,
    bookId: volume.bookId,
    bookTitle: volume.bookTitle,
    collectionNo: volume.collectionNo,
    volumeNo: volume.volumeNo,
    submitter: '',
    submittedDate: new Date().toISOString().slice(0, 10),
    remark: '',
    source: 'room',
    readOnly: false
  };
}
