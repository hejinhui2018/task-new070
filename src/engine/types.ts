export type RoleId = 'employee' | 'supervisor' | 'partner';
export type Actor = RoleId | 'sender' | 'system';

export type EnvelopeStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export interface DocVersion {
  version: number;
  title: string;
  pages: string[];
  fingerprint: string;
  issuedAtTick: number;
  note: string;
}

export interface Signature {
  envelopeId: number;
  docVersion: number;
  fingerprint: string;
  chainHash: string;
  tick: number;
  receiptId: string;
}

export interface SignerState {
  role: RoleId;
  identityConfirmed: boolean;
  viewedVersion: number | null;
  signature: Signature | null;
  declined: boolean;
}

export type IntentType =
  | 'send'
  | 'wait'
  | 'view'
  | 'confirm_identity'
  | 'sign'
  | 'decline'
  | 'withdraw'
  | 'replace_doc'
  | 'reinitiate'
  | 'expire'
  | 'submit_check';

/** 一次动作回执：actor 在 issuedTick 时基于 baseFingerprint 所见的文件做出决定 */
export interface Intent {
  type: IntentType;
  actor: Actor;
  envelopeId: number;
  receiptId: string;
  issuedTick: number;
  baseVersion: number;
  baseFingerprint: string;
  note?: string;
}

export type Verdict = 'applied' | 'rejected' | 'stale' | 'duplicate' | 'info';

export interface LogEntry {
  seq: number;
  tick: number;
  intent: Intent;
  verdict: Verdict;
  reason: string;
  prevHash: string;
  hash: string;
}

/** 在途回执：lag 产生的延迟投递，copiesLeft 为待投递的重复副本数 */
export interface InFlight {
  intent: Intent;
  deliverAtTick: number;
  copiesLeft: number;
}

export interface EngineState {
  tick: number;
  envelopeId: number;
  status: EnvelopeStatus;
  declineReason: string | null;
  doc: DocVersion;
  docHistory: DocVersion[];
  order: RoleId[];
  stepIndex: number;
  signers: Record<RoleId, SignerState>;
  inFlight: InFlight[];
  log: LogEntry[];
  headHash: string;
  ttl: number;
  sentAtTick: number | null;
  receiptCounter: number;
}

export interface IntentTemplate {
  type: IntentType;
  actor: Actor;
  /** 模拟旧版客户端：仍基于上一版文件指纹做决定 */
  staleClient?: boolean;
  note?: string;
}

export interface DispatchOptions {
  /** 回执延迟 N tick 投递（故障注入） */
  lag?: number;
  /** 同一回执投递份数（故障注入重复回执） */
  copies?: number;
  /** 先推进 N tick 再执行本动作 */
  advance?: number;
}

export interface ScenarioStep {
  label: string;
  tpl: IntentTemplate;
  lag?: number;
  copies?: number;
  advance?: number;
}

export interface Scenario {
  id: string;
  name: string;
  desc: string;
  steps: ScenarioStep[];
}

export interface SignerView {
  role: RoleId;
  identityConfirmed: boolean;
  viewedCurrent: boolean;
  signature: Signature | null;
  declined: boolean;
  /** 链绑定校验：此刻是否有效 */
  sigValid: boolean;
  invalidReason: string | null;
  /** 旧系统视图：只看“签过没有”，提交时才暴露问题 */
  legacyValid: boolean;
  isCurrent: boolean;
  phase: 'waiting' | 'current' | 'signed-valid' | 'signed-stale' | 'declined';
}
