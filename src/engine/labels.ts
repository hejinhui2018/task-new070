import type { Actor, EnvelopeStatus, IntentType, RoleId, Verdict } from './types';

export const ROLE_IDS: RoleId[] = ['employee', 'supervisor', 'partner'];

export const ACTOR_META: Record<
  Actor,
  { label: string; short: string; kind: 'internal' | 'external' | 'system'; auth: string }
> = {
  employee: { label: '员工 · 张晓', short: '员工', kind: 'internal', auth: '工号 + 人脸核身' },
  supervisor: { label: '主管 · 李岚', short: '主管', kind: 'internal', auth: '工号 + 人脸核身' },
  partner: { label: '合作方 · 陈屿', short: '外部合作方', kind: 'external', auth: '短信验证码 + 邮箱签署链接' },
  sender: { label: '发件人 · 法务部', short: '发件人', kind: 'system', auth: '—' },
  system: { label: '系统', short: '系统', kind: 'system', auth: '—' },
};

export const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  rejected: '已被拒签',
  withdrawn: '已撤回',
  expired: '已过期',
};

export const TYPE_LABEL: Record<IntentType, string> = {
  send: '发送',
  wait: '等待',
  view: '查阅',
  confirm_identity: '身份确认',
  sign: '签署',
  decline: '拒签',
  withdraw: '撤回',
  replace_doc: '补页换版',
  reinitiate: '重新发起',
  expire: '过期',
  submit_check: '提交校验',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  applied: '已受理',
  rejected: '已拒收',
  stale: '已作废',
  duplicate: '重复忽略',
  info: '信息',
};
