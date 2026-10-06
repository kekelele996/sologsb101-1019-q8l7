/**
 * 专家委员会批复（CommitteeApproval）数据模型
 * 属于专家委员会上下文：按方案单号与册次号独立登记。
 * 不直接修改修复室古籍、册次或工序；修复室只按册次号读取最新批复来约束后续工序。
 */
import type { RepairLevel } from './repairPlan';

/** 批复状态：同意 / 驳回 / 撤回 */
export type ApprovalStatus = 'approved' | 'rejected' | 'withdrawn';

/** 批复来源：委员会登记 / 升级时历史回填 */
export type ApprovalSource = 'committee' | 'history';

export interface CommitteeApproval {
  id: string;
  /** 批复单号 */
  approvalNo: string;
  /** 方案单号；可对应修复室上报单，也允许委员会先手工登记后对账 */
  planNo: string;
  /** 若由修复室方案发起，冗余方案 id；否则为空 */
  planId: string;
  /** 批复状态 */
  status: ApprovalStatus;
  /** 批复级别；驳回或撤回时为空 */
  decisionLevel: RepairLevel | null;
  /** 对账用收藏号 */
  collectionNo: string;
  /** 对账用册次号 */
  volumeNo: number;
  /** 修复室册次主键；能对上时冗余，对不上为空，不影响委员会台账 */
  volumeId: string;
  /** 冗余书名，仅作展示 */
  bookTitle: string;
  /** 批复日期 yyyy-MM-dd */
  decidedDate: string;
  /** 委员会专家 / 经办人 */
  reviewer: string;
  /** 批复意见 */
  opinion: string;
  source: ApprovalSource;
  /** 历史回填、撤回或无法对账的记录只读 */
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CommitteeApprovalDraft = Omit<CommitteeApproval, 'id' | 'createdAt' | 'updatedAt'>;

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  approved: '同意',
  rejected: '驳回',
  withdrawn: '撤回'
};

export const APPROVAL_STATUS_COLOR: Record<ApprovalStatus, string> = {
  approved: '#1e8449',
  rejected: '#b03a2e',
  withdrawn: '#8c8c8c'
};

export const APPROVAL_STATUS_OPTIONS: ReadonlyArray<{ value: ApprovalStatus; label: string }> = [
  { value: 'approved', label: '同意' },
  { value: 'rejected', label: '驳回' },
  { value: 'withdrawn', label: '撤回' }
];

export const APPROVAL_SOURCE_LABEL: Record<ApprovalSource, string> = {
  committee: '委员会登记',
  history: '历史回填'
};

export function createEmptyApprovalDraft(): CommitteeApprovalDraft {
  return {
    approvalNo: '',
    planNo: '',
    planId: '',
    status: 'approved',
    decisionLevel: 'partial',
    collectionNo: '',
    volumeNo: 1,
    volumeId: '',
    bookTitle: '',
    decidedDate: new Date().toISOString().slice(0, 10),
    reviewer: '',
    opinion: '',
    source: 'committee',
    readOnly: false
  };
}
