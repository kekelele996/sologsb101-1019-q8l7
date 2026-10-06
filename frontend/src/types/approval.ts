/**
 * 修复方案批复（RepairApproval）数据模型
 * 古籍修复专家委员会一侧的登记：按方案单号 + 册次号对账批复修复级别。
 * 与修复室各记各的：本侧只登记方案单与批复级别，不触碰古籍 / 册次 / 工序数据；
 * 两侧靠册次号（volumeId）对账。
 */

/** 批复级别：全面修复 / 局部修复 / 加固 */
export type ApprovalLevel = 'full' | 'partial' | 'reinforce';

/** 批复状态：批复 / 驳回 / 撤回（修复室收到驳回 / 撤回后只需重发本侧方案单） */
export type ApprovalStatus = 'approved' | 'rejected' | 'withdrawn';

export interface RepairApproval {
  id: string;
  /** 方案单号，委员会与修复室对账凭据（同册次以晚到的批复为准） */
  planNo: string;
  /** 对账册次 id（册次号在册次实体上，批复只存引用） */
  volumeId: string;
  /** 批复级别；驳回 / 撤回时保留上一份批复的级别留痕 */
  level: ApprovalLevel;
  /** 批复状态 */
  status: ApprovalStatus;
  /** 委员会批复意见 */
  opinion: string;
  /** 批复人（专家委员会） */
  approver: string;
  /** 批复日期 yyyy-MM-dd */
  decidedAt: string;
  /** 是否为升级时按整册进度回填的历史批复（无方案单的旧数据） */
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RepairApprovalDraft = Omit<RepairApproval, 'id' | 'createdAt' | 'updatedAt'>;

export const APPROVAL_LEVEL_LABEL: Record<ApprovalLevel, string> = {
  full: '全面修复',
  partial: '局部修复',
  reinforce: '加固',
};

export const APPROVAL_LEVEL_COLOR: Record<ApprovalLevel, string> = {
  full: '#b03a2e',
  partial: '#a8623a',
  reinforce: '#3a6ea5',
};

export const APPROVAL_LEVEL_OPTIONS: ReadonlyArray<{ value: ApprovalLevel; label: string }> = [
  { value: 'full', label: '全面修复' },
  { value: 'partial', label: '局部修复' },
  { value: 'reinforce', label: '加固' },
];

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  approved: '批复',
  rejected: '驳回',
  withdrawn: '撤回',
};

export const APPROVAL_STATUS_COLOR: Record<ApprovalStatus, string> = {
  approved: '#1e8449',
  rejected: '#b03a2e',
  withdrawn: '#8c8c8c',
};

export const APPROVAL_STATUS_OPTIONS: ReadonlyArray<{ value: ApprovalStatus; label: string }> = [
  { value: 'approved', label: '批复' },
  { value: 'rejected', label: '驳回' },
  { value: 'withdrawn', label: '撤回' },
];

/** 各档级别允许开展的工序名；未列出的工序一律挡回 */
export const LEVEL_ALLOWED_ORDERS: Record<ApprovalLevel, ReadonlySet<string>> = {
  // 全面修复：补破、托裱、溜口、裁齐、压平均可
  full: new Set(['mend', 'mount', 'corner', 'trim', 'press']),
  // 局部修复：补破、溜口、压平（不做整叶托裱与裁齐）
  partial: new Set(['mend', 'corner', 'press']),
  // 加固档：只准补破和溜口，托裱、裁齐一律挡回
  reinforce: new Set(['mend', 'corner']),
};

/** 方案未批复 / 无有效批复时是否允许动工：默认只读，须先有批复 */
export function isOrderAllowedByLevel(level: ApprovalLevel | null, orderName: string): boolean {
  if (!level) return false;
  return LEVEL_ALLOWED_ORDERS[level].has(orderName);
}

export function createEmptyApprovalDraft(volumeId: string, planNo: string): RepairApprovalDraft {
  return {
    planNo,
    volumeId,
    level: 'full',
    status: 'approved',
    opinion: '',
    approver: '',
    decidedAt: new Date().toISOString().slice(0, 10),
    historical: false,
  };
}
