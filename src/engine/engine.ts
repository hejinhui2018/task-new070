import { chainHash, fingerprint, shortHash } from './hash';
import { ACTOR_META, STATUS_LABEL } from './labels';
import type {
  Actor,
  DispatchOptions,
  DocVersion,
  EngineState,
  Intent,
  IntentTemplate,
  LogEntry,
  RoleId,
  Signature,
  SignerState,
  SignerView,
  Verdict,
} from './types';

export const GENESIS = '0000000000000000';
export const DOC_TITLE = '劳动合同（2026 版）';
export const DEFAULT_TTL = 20;

const BASE_PAGES = ['劳动合同正文', '保密与知识产权条款', '附件A · 岗位职责'];
const EXTRA_PAGES = ['补充协议 · 远程办公', '风险披露书', '补充说明 · 竞业限制', '附件B · 薪酬确认书'];

export function makeDoc(version: number, pages: string[], tick: number, note: string): DocVersion {
  return {
    version,
    title: DOC_TITLE,
    pages,
    fingerprint: fingerprint(`doc|${DOC_TITLE}|v${version}|${pages.join('|')}`),
    issuedAtTick: tick,
    note,
  };
}

export function freshSigners(): Record<RoleId, SignerState> {
  const mk = (role: RoleId): SignerState => ({
    role,
    identityConfirmed: false,
    viewedVersion: null,
    signature: null,
    declined: false,
  });
  return { employee: mk('employee'), supervisor: mk('supervisor'), partner: mk('partner') };
}

export function initialState(ttl: number = DEFAULT_TTL): EngineState {
  return {
    tick: 0,
    envelopeId: 1,
    status: 'draft',
    declineReason: null,
    doc: makeDoc(1, BASE_PAGES, 0, '初始版本'),
    docHistory: [],
    order: ['employee', 'supervisor', 'partner'],
    stepIndex: 0,
    signers: freshSigners(),
    inFlight: [],
    log: [],
    headHash: GENESIS,
    ttl,
    sentAtTick: null,
    receiptCounter: 0,
  };
}

function isRole(actor: Actor): actor is RoleId {
  return actor === 'employee' || actor === 'supervisor' || actor === 'partner';
}

/* ---------- 证据链 ---------- */

function computeHash(state: EngineState, seq: number, intent: Intent, verdict: Verdict): string {
  const canonical = [
    seq,
    state.tick,
    intent.receiptId,
    intent.type,
    intent.actor,
    intent.envelopeId,
    intent.baseVersion,
    intent.baseFingerprint,
    verdict,
  ].join('|');
  return chainHash(state.headHash, canonical);
}

function appendLogWithHash(
  state: EngineState,
  intent: Intent,
  verdict: Verdict,
  reason: string,
  seq: number,
  hash: string,
): EngineState {
  const entry: LogEntry = { seq, tick: state.tick, intent, verdict, reason, prevHash: state.headHash, hash };
  return { ...state, log: [...state.log, entry], headHash: hash };
}

function appendLog(state: EngineState, intent: Intent, verdict: Verdict, reason: string): EngineState {
  const seq = state.log.length + 1;
  return appendLogWithHash(state, intent, verdict, reason, seq, computeHash(state, seq, intent, verdict));
}

export function verifyChain(state: EngineState): { ok: boolean; mismatchAt: number | null } {
  let prev = GENESIS;
  for (const e of state.log) {
    const canonical = [
      e.seq,
      e.tick,
      e.intent.receiptId,
      e.intent.type,
      e.intent.actor,
      e.intent.envelopeId,
      e.intent.baseVersion,
      e.intent.baseFingerprint,
      e.verdict,
    ].join('|');
    const h = chainHash(prev, canonical);
    if (h !== e.hash || e.prevHash !== prev) return { ok: false, mismatchAt: e.seq };
    prev = e.hash;
  }
  return prev === state.headHash
    ? { ok: true, mismatchAt: null }
    : { ok: false, mismatchAt: state.log[state.log.length - 1]?.seq ?? null };
}

/* ---------- 工具 ---------- */

function patchSigner(state: EngineState, role: RoleId, patch: Partial<SignerState>): EngineState {
  return { ...state, signers: { ...state.signers, [role]: { ...state.signers[role], ...patch } } };
}

/** 当前信封中仍绑定当前指纹的签名数 */
function countBoundSignatures(state: EngineState): number {
  return state.order.filter((r) => {
    const sig = state.signers[r].signature;
    return sig !== null && sig.envelopeId === state.envelopeId && sig.fingerprint === state.doc.fingerprint;
  }).length;
}

function guardActive(state: EngineState): { verdict: Verdict; reason: string } | null {
  switch (state.status) {
    case 'active':
      return null;
    case 'draft':
      return { verdict: 'rejected', reason: `信封 #${state.envelopeId} 仍是草稿，尚未发送 → 回执拒收` };
    default:
      return { verdict: 'rejected', reason: `信封 #${state.envelopeId} ${STATUS_LABEL[state.status]}，回执作废` };
  }
}

function materialize(state: EngineState, tpl: IntentTemplate): Intent {
  const prevDoc = state.docHistory[state.docHistory.length - 1];
  const base = tpl.staleClient && prevDoc ? prevDoc : state.doc;
  return {
    type: tpl.type,
    actor: tpl.actor,
    envelopeId: state.envelopeId,
    receiptId: `R${state.envelopeId}-${state.receiptCounter + 1}`,
    issuedTick: state.tick,
    baseVersion: base.version,
    baseFingerprint: base.fingerprint,
    note: tpl.note,
  };
}

/* ---------- 入口：dispatch / tick ---------- */

export function dispatch(state: EngineState, tpl: IntentTemplate, opts: DispatchOptions = {}): EngineState {
  let st = state;
  const advance = opts.advance ?? 0;
  for (let i = 0; i < advance; i++) st = tickOnce(st);
  st = tickOnce(st);
  const intent = materialize(st, tpl);
  st = { ...st, receiptCounter: st.receiptCounter + 1 };
  const lag = opts.lag ?? 0;
  const copies = Math.max(1, opts.copies ?? 1);
  if (lag > 0) {
    return { ...st, inFlight: [...st.inFlight, { intent, deliverAtTick: st.tick + lag, copiesLeft: copies - 1 }] };
  }
  st = applyIntent(st, intent);
  for (let i = 1; i < copies; i++) st = applyIntent(st, intent);
  return st;
}

export function tickOnce(state: EngineState): EngineState {
  let st: EngineState = { ...state, tick: state.tick + 1 };
  const due = st.inFlight
    .filter((f) => f.deliverAtTick <= st.tick)
    .sort((a, b) => a.deliverAtTick - b.deliverAtTick);
  if (due.length > 0) {
    st = { ...st, inFlight: st.inFlight.filter((f) => f.deliverAtTick > st.tick) };
    for (const f of due) {
      st = applyIntent(st, f.intent);
      for (let i = 0; i < f.copiesLeft; i++) st = applyIntent(st, f.intent);
    }
  }
  if (st.status === 'active' && st.sentAtTick !== null && st.tick - st.sentAtTick > st.ttl) {
    st = applyIntent(st, {
      type: 'expire',
      actor: 'system',
      envelopeId: st.envelopeId,
      receiptId: `SYS-EXP-${st.envelopeId}-${st.tick}`,
      issuedTick: st.tick,
      baseVersion: st.doc.version,
      baseFingerprint: st.doc.fingerprint,
    });
  }
  return st;
}

/* ---------- 规则核心 ---------- */

function applyIntent(state: EngineState, intent: Intent): EngineState {
  // 幂等：同一回执编号只处理一次
  const seen = state.log.find((e) => e.intent.receiptId === intent.receiptId);
  if (seen) {
    return appendLog(
      state,
      intent,
      'duplicate',
      `回执 ${intent.receiptId} 已在 #${seen.seq} 处理过 → 幂等忽略，状态不变（重复投递安全）`,
    );
  }
  // 旧信封的晚到回执
  if (intent.envelopeId !== state.envelopeId) {
    return appendLog(
      state,
      intent,
      'stale',
      `回执属于旧信封 #${intent.envelopeId}（当前活动信封 #${state.envelopeId}）→ 作废；旧信封的签名不继承`,
    );
  }
  const late = state.tick - intent.issuedTick;
  const lateNote = late >= 2 ? `晚到 ${late} tick 的回执；` : '';
  const actorName = ACTOR_META[intent.actor].short;

  switch (intent.type) {
    case 'wait':
      return appendLog(state, intent, 'info', `时间推进至 tick ${state.tick}`);

    case 'send': {
      if (intent.actor !== 'sender') return appendLog(state, intent, 'rejected', '只有发件人可以发送信封');
      if (state.status !== 'draft') {
        return appendLog(
          state,
          intent,
          'rejected',
          `信封 #${state.envelopeId} 当前为「${STATUS_LABEL[state.status]}」，不能重复发送；如需再次签署请重新发起`,
        );
      }
      const st: EngineState = { ...state, status: 'active', sentAtTick: state.tick };
      const orderText = state.order.map((r) => ACTOR_META[r].short).join(' → ');
      return appendLog(
        st,
        intent,
        'applied',
        `信封 #${state.envelopeId} 已发送：文件 v${state.doc.version}（${state.doc.pages.length} 页，指纹 ${shortHash(state.doc.fingerprint)}），签署顺序 ${orderText}，有效期 ${state.ttl} tick`,
      );
    }

    case 'view': {
      if (!isRole(intent.actor)) return appendLog(state, intent, 'rejected', '只有签署角色需要查阅');
      const g = guardActive(state);
      if (g) return appendLog(state, intent, g.verdict, lateNote + g.reason);
      const st = patchSigner(state, intent.actor, { viewedVersion: state.doc.version });
      return appendLog(
        st,
        intent,
        'applied',
        `${lateNote}${actorName}查阅了 v${state.doc.version}（${state.doc.pages.length} 页，指纹 ${shortHash(state.doc.fingerprint)}）；查阅记录上链，签署必须基于该指纹`,
      );
    }

    case 'confirm_identity': {
      if (!isRole(intent.actor)) return appendLog(state, intent, 'rejected', '只有签署角色需要身份确认');
      const g = guardActive(state);
      if (g) return appendLog(state, intent, g.verdict, lateNote + g.reason);
      if (state.signers[intent.actor].identityConfirmed) {
        return appendLog(state, intent, 'info', `${lateNote}${actorName}此前已完成身份确认，重复确认忽略`);
      }
      const st = patchSigner(state, intent.actor, { identityConfirmed: true });
      return appendLog(
        st,
        intent,
        'applied',
        `${lateNote}${actorName}完成身份确认（${ACTOR_META[intent.actor].auth}），确认结果与当前链头绑定`,
      );
    }

    case 'sign': {
      if (!isRole(intent.actor)) return appendLog(state, intent, 'rejected', '只有签署角色可以签署');
      const g = guardActive(state);
      if (g) return appendLog(state, intent, g.verdict, lateNote + g.reason);
      const role = intent.actor;
      const signer = state.signers[role];
      const expected = state.order[state.stepIndex] as RoleId | undefined;
      if (expected === undefined || role !== expected) {
        return appendLog(
          state,
          intent,
          'rejected',
          `${lateNote}顺序冲突：当前待签方为 ${expected ? ACTOR_META[expected].short : '无'}（第 ${state.stepIndex + 1}/${state.order.length} 顺位），却收到${actorName}的回执 → 拒收，流程位置不变`,
        );
      }
      if (!signer.identityConfirmed) {
        return appendLog(
          state,
          intent,
          'rejected',
          `${lateNote}${actorName}尚未完成身份确认（${ACTOR_META[role].auth}）→ 拒收`,
        );
      }
      if (intent.baseFingerprint !== state.doc.fingerprint) {
        return appendLog(
          state,
          intent,
          'stale',
          `${lateNote}签署绑定 v${intent.baseVersion} 指纹 ${shortHash(intent.baseFingerprint)}，但当前文件已是 v${state.doc.version}（${shortHash(state.doc.fingerprint)}）→ 作废，需基于新版本重新查阅并签署`,
        );
      }
      if (signer.viewedVersion !== state.doc.version) {
        return appendLog(
          state,
          intent,
          'rejected',
          `${lateNote}${actorName}未查阅当前版本 v${state.doc.version}（查阅记录：${signer.viewedVersion === null ? '无' : `v${signer.viewedVersion}`}）→ 拒收`,
        );
      }
      const seq = state.log.length + 1;
      const hash = computeHash(state, seq, intent, 'applied');
      const sig: Signature = {
        envelopeId: state.envelopeId,
        docVersion: state.doc.version,
        fingerprint: state.doc.fingerprint,
        chainHash: hash,
        tick: state.tick,
        receiptId: intent.receiptId,
      };
      const nextStep = state.stepIndex + 1;
      const done = nextStep >= state.order.length;
      const st: EngineState = {
        ...state,
        signers: { ...state.signers, [role]: { ...signer, signature: sig } },
        stepIndex: nextStep,
        status: done ? 'completed' : state.status,
      };
      const reason = done
        ? `${lateNote}${actorName}签署 v${state.doc.version} 受理：绑定指纹 ${shortHash(sig.fingerprint)}，链位置 #${seq}；三方签署齐备，信封 #${state.envelopeId} 封存`
        : `${lateNote}${actorName}签署 v${state.doc.version} 受理：绑定指纹 ${shortHash(sig.fingerprint)}，链位置 #${seq}；下一顺位 ${ACTOR_META[state.order[nextStep]].short}`;
      return appendLogWithHash(st, intent, 'applied', reason, seq, hash);
    }

    case 'decline': {
      if (!isRole(intent.actor)) return appendLog(state, intent, 'rejected', '只有签署角色可以拒签');
      const g = guardActive(state);
      if (g) return appendLog(state, intent, g.verdict, lateNote + g.reason);
      const affected = countBoundSignatures(state);
      const note = intent.note ?? '未说明理由';
      const st: EngineState = {
        ...patchSigner(state, intent.actor, { declined: true }),
        status: 'rejected',
        declineReason: note,
      };
      return appendLog(
        st,
        intent,
        'applied',
        `${lateNote}${actorName}拒签（${note}）：信封 #${state.envelopeId} 终止，${affected} 处已签记录随之作废；如需继续请重新发起`,
      );
    }

    case 'withdraw': {
      if (intent.actor !== 'sender') return appendLog(state, intent, 'rejected', '只有发件人可以撤回信封');
      if (state.status !== 'active') {
        return appendLog(state, intent, 'rejected', `仅「进行中」的信封可撤回（当前：${STATUS_LABEL[state.status]}）`);
      }
      const affected = countBoundSignatures(state);
      const st: EngineState = { ...state, status: 'withdrawn' };
      return appendLog(
        st,
        intent,
        'applied',
        `发件人撤回信封 #${state.envelopeId}：${affected} 处已签记录随之作废；在途回执到达后将被拒收`,
      );
    }

    case 'replace_doc': {
      if (intent.actor !== 'sender') return appendLog(state, intent, 'rejected', '只有发件人可以换版');
      if (state.status !== 'active' && state.status !== 'draft') {
        return appendLog(
          state,
          intent,
          'rejected',
          `信封 #${state.envelopeId} ${STATUS_LABEL[state.status]}，不能换版；请先重新发起`,
        );
      }
      const oldDoc = state.doc;
      const firstReplace = state.docHistory.length === 0;
      const addCount = firstReplace ? 2 : 1;
      const poolIndex = firstReplace ? 0 : 1 + state.docHistory.length;
      const added = Array.from(
        { length: addCount },
        (_, i) => EXTRA_PAGES[poolIndex + i] ?? `补充页 · 第${oldDoc.version}次修订`,
      );
      const newDoc = makeDoc(oldDoc.version + 1, [...oldDoc.pages, ...added], state.tick, intent.note ?? '补页换版');
      const affected = countBoundSignatures(state);
      const signers: Record<RoleId, SignerState> = {
        employee: { ...state.signers.employee, viewedVersion: null },
        supervisor: { ...state.signers.supervisor, viewedVersion: null },
        partner: { ...state.signers.partner, viewedVersion: null },
      };
      const st: EngineState = {
        ...state,
        doc: newDoc,
        docHistory: [...state.docHistory, oldDoc],
        stepIndex: 0,
        signers,
      };
      return appendLog(
        st,
        intent,
        'applied',
        `文件补页：v${oldDoc.version} → v${newDoc.version}（${oldDoc.pages.length} → ${newDoc.pages.length} 页，新增「${added.join('」「')}」），指纹 ${shortHash(oldDoc.fingerprint)} → ${shortHash(newDoc.fingerprint)}；${affected} 处已签记录立即失效（仍绑定旧指纹），签署顺序重置为第 1 顺位，各方需重新查阅`,
      );
    }

    case 'reinitiate': {
      if (intent.actor !== 'sender') return appendLog(state, intent, 'rejected', '只有发件人可以重新发起');
      if (state.status === 'draft' || state.status === 'active') {
        return appendLog(state, intent, 'rejected', `仅终态信封可重新发起（当前：${STATUS_LABEL[state.status]}）`);
      }
      const newEnv = state.envelopeId + 1;
      const st: EngineState = {
        ...state,
        envelopeId: newEnv,
        status: 'draft',
        stepIndex: 0,
        signers: freshSigners(),
        sentAtTick: null,
        declineReason: null,
      };
      return appendLog(
        st,
        intent,
        'applied',
        `重新发起 → 信封 #${newEnv}（草稿）：沿用文件 v${state.doc.version}（${shortHash(state.doc.fingerprint)}）；信封 #${state.envelopeId} 的链上记录保留为审计轨迹，签名不继承，各方需重新确认身份`,
      );
    }

    case 'expire': {
      if (state.status !== 'active') return appendLog(state, intent, 'info', '到期检查：信封非进行中，无动作');
      const affected = countBoundSignatures(state);
      const st: EngineState = { ...state, status: 'expired' };
      return appendLog(
        st,
        intent,
        'applied',
        `到达签署截止（发送后 ${state.ttl} tick）：信封 #${state.envelopeId} 过期，${affected} 处已签记录作废，签署未完成；可重新发起`,
      );
    }

    case 'submit_check': {
      const invalid = state.order.filter((r) => {
        const sig = state.signers[r].signature;
        return !sig || sig.envelopeId !== state.envelopeId || sig.fingerprint !== state.doc.fingerprint;
      });
      if (state.status === 'completed' && invalid.length === 0) {
        return appendLog(
          state,
          intent,
          'info',
          `提交校验通过：${state.order.length} 处签名均绑定当前指纹 ${shortHash(state.doc.fingerprint)}，证据链完整`,
        );
      }
      const names = invalid.map((r) => ACTOR_META[r].short).join('、');
      return appendLog(
        state,
        intent,
        'info',
        `提交校验（旧系统视角）：${names} 的签名缺失或仍绑定旧版本 → 整份文件需重签。链绑定机制在签署当下即标记失效，不必等到提交才发现`,
      );
    }
  }
}

/* ---------- 派生视图 ---------- */

export function deriveSigners(state: EngineState): SignerView[] {
  const alive = state.status === 'active' || state.status === 'completed';
  return state.order.map((role) => {
    const s = state.signers[role];
    const sig = s.signature;
    let invalidReason: string | null = null;
    if (sig) {
      if (sig.envelopeId !== state.envelopeId) invalidReason = `属于旧信封 #${sig.envelopeId}，不继承`;
      else if (state.status === 'withdrawn') invalidReason = '信封已撤回';
      else if (state.status === 'expired') invalidReason = '信封已过期';
      else if (state.status === 'rejected') invalidReason = '信封已被拒签终止';
      else if (sig.fingerprint !== state.doc.fingerprint) {
        invalidReason = `绑定 v${sig.docVersion}（${shortHash(sig.fingerprint)}），当前为 v${state.doc.version}（${shortHash(state.doc.fingerprint)}）`;
      }
    }
    const sigValid = sig !== null && invalidReason === null && alive;
    const legacyValid = sig !== null && sig.envelopeId === state.envelopeId && alive;
    const isCurrent = state.status === 'active' && state.order[state.stepIndex] === role;
    const phase: SignerView['phase'] = s.declined
      ? 'declined'
      : sigValid
        ? 'signed-valid'
        : sig !== null
          ? 'signed-stale'
          : isCurrent
            ? 'current'
            : 'waiting';
    return {
      role,
      identityConfirmed: s.identityConfirmed,
      viewedCurrent: s.viewedVersion === state.doc.version,
      signature: sig,
      declined: s.declined,
      sigValid,
      invalidReason,
      legacyValid,
      isCurrent,
      phase,
    };
  });
}

export function remainingTicks(state: EngineState): number | null {
  if (state.status !== 'active' || state.sentAtTick === null) return null;
  return Math.max(0, state.ttl - (state.tick - state.sentAtTick));
}
