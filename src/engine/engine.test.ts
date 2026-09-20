import { describe, expect, it } from 'vitest';
import { deriveSigners, dispatch, initialState, verifyChain } from './engine';
import { SCENARIOS } from './scenarios';
import type { EngineState, ScenarioStep } from './types';

function runSteps(state: EngineState, steps: ScenarioStep[]): EngineState {
  return steps.reduce(
    (s, st) => dispatch(s, st.tpl, { lag: st.lag, copies: st.copies, advance: st.advance }),
    state,
  );
}

function runScenario(id: string): EngineState {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`unknown scenario ${id}`);
  return runSteps(initialState(), sc.steps);
}

const lastEntry = (s: EngineState) => s.log[s.log.length - 1];

/** 快进到处方：发送 + 员工完成签署 */
function sentWithEmployeeSigned(): EngineState {
  let s = initialState();
  s = dispatch(s, { type: 'send', actor: 'sender' });
  s = dispatch(s, { type: 'view', actor: 'employee' });
  s = dispatch(s, { type: 'confirm_identity', actor: 'employee' });
  s = dispatch(s, { type: 'sign', actor: 'employee' });
  return s;
}

describe('签署顺序', () => {
  it('乱序签署被顺序守卫拒收，流程位置不变', () => {
    let s = initialState();
    s = dispatch(s, { type: 'send', actor: 'sender' });
    s = dispatch(s, { type: 'view', actor: 'supervisor' });
    s = dispatch(s, { type: 'confirm_identity', actor: 'supervisor' });
    s = dispatch(s, { type: 'sign', actor: 'supervisor' });
    const e = lastEntry(s);
    expect(e.verdict).toBe('rejected');
    expect(e.reason).toContain('顺序');
    expect(s.stepIndex).toBe(0);
    expect(s.signers.supervisor.signature).toBeNull();
  });

  it('未完成身份确认的签署被拒收', () => {
    let s = initialState();
    s = dispatch(s, { type: 'send', actor: 'sender' });
    s = dispatch(s, { type: 'view', actor: 'employee' });
    s = dispatch(s, { type: 'sign', actor: 'employee' });
    expect(lastEntry(s).verdict).toBe('rejected');
    expect(lastEntry(s).reason).toContain('身份确认');
    expect(s.signers.employee.signature).toBeNull();
  });

  it('标准剧本三方依次签署完成，证据链完整', () => {
    const s = runScenario('happy');
    expect(s.status).toBe('completed');
    expect(deriveSigners(s).every((v) => v.sigValid)).toBe(true);
    expect(verifyChain(s).ok).toBe(true);
  });

  it('顺序冲突剧本：抢签被拒后按序重试可通过', () => {
    const s = runScenario('order');
    expect(s.status).toBe('completed');
    const rejected = s.log.find((e) => e.verdict === 'rejected');
    expect(rejected?.reason).toContain('顺序冲突');
    expect(verifyChain(s).ok).toBe(true);
  });
});

describe('补页换版', () => {
  it('补页后旧签名立即失效（无需等待提交），旧系统视图仍显示有效', () => {
    let s = sentWithEmployeeSigned();
    s = dispatch(s, { type: 'view', actor: 'supervisor' });
    s = dispatch(s, { type: 'confirm_identity', actor: 'supervisor' });
    s = dispatch(s, { type: 'sign', actor: 'supervisor' });
    expect(deriveSigners(s).filter((v) => v.sigValid)).toHaveLength(2);

    s = dispatch(s, { type: 'replace_doc', actor: 'sender' });
    const views = deriveSigners(s);
    expect(views[0].sigValid).toBe(false);
    expect(views[0].invalidReason).toContain('v1');
    expect(views[1].sigValid).toBe(false);
    // 痛点复现：旧系统视图在补页后仍显示“有效”
    expect(views[0].legacyValid).toBe(true);
    expect(views[1].legacyValid).toBe(true);
    expect(s.stepIndex).toBe(0);
    expect(s.doc.version).toBe(2);
  });

  it('换版后基于旧指纹的签署判作废，基于新指纹重签恢复有效', () => {
    let s = sentWithEmployeeSigned();
    s = dispatch(s, { type: 'replace_doc', actor: 'sender' });
    s = dispatch(s, { type: 'view', actor: 'employee' });
    // 旧版客户端：仍按 v1 指纹签署
    s = dispatch(s, { type: 'sign', actor: 'employee', staleClient: true });
    expect(lastEntry(s).verdict).toBe('stale');
    expect(lastEntry(s).reason).toContain('作废');
    // 基于当前版本重签
    s = dispatch(s, { type: 'sign', actor: 'employee' });
    expect(lastEntry(s).verdict).toBe('applied');
    expect(deriveSigners(s)[0].sigValid).toBe(true);
  });

  it('补页剧本全程跑通并完成，链完整', () => {
    const s = runScenario('replace');
    expect(s.status).toBe('completed');
    expect(s.doc.version).toBe(2);
    expect(verifyChain(s).ok).toBe(true);
    // 换版记录可解释
    const replaced = s.log.find((e) => e.intent.type === 'replace_doc');
    expect(replaced?.reason).toContain('立即失效');
  });
});

describe('撤回与重新发起', () => {
  it('撤回后晚到回执被拒收，已签记录作废', () => {
    let s = sentWithEmployeeSigned();
    s = dispatch(s, { type: 'view', actor: 'supervisor' });
    s = dispatch(s, { type: 'confirm_identity', actor: 'supervisor' });
    s = dispatch(s, { type: 'sign', actor: 'supervisor' }, { lag: 2 });
    s = dispatch(s, { type: 'withdraw', actor: 'sender' });
    expect(s.status).toBe('withdrawn');
    s = dispatch(s, { type: 'wait', actor: 'system' });
    const late = s.log.find((e) => e.intent.type === 'sign' && e.intent.actor === 'supervisor');
    expect(late?.verdict).toBe('rejected');
    expect(late?.reason).toContain('已撤回');
    expect(deriveSigners(s)[0].sigValid).toBe(false);
    expect(deriveSigners(s)[0].invalidReason).toContain('撤回');
  });

  it('重新发起生成新信封，旧签名不继承，旧回执判作废', () => {
    let s = sentWithEmployeeSigned();
    s = dispatch(s, { type: 'withdraw', actor: 'sender' });
    s = dispatch(s, { type: 'reinitiate', actor: 'sender' });
    expect(s.envelopeId).toBe(2);
    expect(s.status).toBe('draft');
    expect(s.signers.employee.signature).toBeNull();
    // 旧信封记录仍保留在链上供审计
    expect(s.log.some((e) => e.intent.envelopeId === 1 && e.verdict === 'applied')).toBe(true);
    expect(verifyChain(s).ok).toBe(true);
  });

  it('撤回重发剧本全程跑通并完成', () => {
    const s = runScenario('withdraw');
    expect(s.status).toBe('completed');
    expect(s.envelopeId).toBe(2);
    expect(s.log.some((e) => e.verdict === 'rejected' && e.reason.includes('已撤回'))).toBe(true);
    expect(verifyChain(s).ok).toBe(true);
  });
});

describe('过期', () => {
  it('到达截止后信封自动过期，迟到签署被拒', () => {
    let s = initialState();
    s = dispatch(s, { type: 'send', actor: 'sender' });
    s = dispatch(s, { type: 'view', actor: 'employee' });
    s = dispatch(s, { type: 'confirm_identity', actor: 'employee' });
    s = dispatch(s, { type: 'wait', actor: 'system' }, { advance: 25 });
    expect(s.status).toBe('expired');
    s = dispatch(s, { type: 'sign', actor: 'employee' });
    expect(lastEntry(s).verdict).toBe('rejected');
    expect(lastEntry(s).reason).toContain('已过期');
  });

  it('过期剧本：过期 → 拒收 → 重新发起 → 完成', () => {
    const s = runScenario('expire');
    expect(s.status).toBe('completed');
    expect(s.envelopeId).toBe(2);
    expect(s.log.some((e) => e.intent.type === 'expire' && e.verdict === 'applied')).toBe(true);
    expect(verifyChain(s).ok).toBe(true);
  });
});

describe('重复回执与重复运行', () => {
  it('同一回执重复投递被幂等忽略，签名只有一条', () => {
    let s = initialState();
    s = dispatch(s, { type: 'send', actor: 'sender' });
    s = dispatch(s, { type: 'view', actor: 'employee' });
    s = dispatch(s, { type: 'confirm_identity', actor: 'employee' });
    s = dispatch(s, { type: 'sign', actor: 'employee' }, { copies: 2 });
    const signs = s.log.filter((e) => e.intent.type === 'sign');
    expect(signs.map((e) => e.verdict)).toEqual(['applied', 'duplicate']);
    expect(deriveSigners(s)[0].sigValid).toBe(true);
    expect(s.stepIndex).toBe(1);
  });

  it('重复运行同一剧本得到完全相同的链头（确定性可重放）', () => {
    for (const id of ['happy', 'order', 'replace', 'late', 'withdraw', 'expire']) {
      const a = runScenario(id);
      const b = runScenario(id);
      expect(a.headHash).toBe(b.headHash);
      expect(a.log.length).toBe(b.log.length);
    }
  });
});

describe('晚到回执', () => {
  it('在途期间文件补页，回执到达即判作废并说明原因', () => {
    const s = runScenario('late');
    const stale = s.log.find((e) => e.verdict === 'stale');
    expect(stale).toBeTruthy();
    expect(stale?.reason).toContain('作废');
    expect(stale?.reason).toContain('v1');
    const dup = s.log.find((e) => e.verdict === 'duplicate');
    expect(dup).toBeTruthy();
    expect(s.status).toBe('completed');
    expect(verifyChain(s).ok).toBe(true);
  });
});

describe('证据链完整性', () => {
  it('篡改任一记录即被链校验发现', () => {
    const s = runScenario('happy');
    expect(verifyChain(s).ok).toBe(true);
    const tampered: EngineState = {
      ...s,
      log: s.log.map((e, i) => (i === 2 ? { ...e, verdict: 'rejected' as const } : e)),
    };
    const check = verifyChain(tampered);
    expect(check.ok).toBe(false);
    expect(check.mismatchAt).toBe(3);
  });

  it('每条记录都绑定当时的文件指纹与前序哈希', () => {
    const s = runScenario('replace');
    for (let i = 1; i < s.log.length; i++) {
      expect(s.log[i].prevHash).toBe(s.log[i - 1].hash);
    }
    const v1Signs = s.log.filter(
      (e) => e.intent.type === 'sign' && e.verdict === 'applied' && e.intent.baseVersion === 1,
    );
    const v2Signs = s.log.filter(
      (e) => e.intent.type === 'sign' && e.verdict === 'applied' && e.intent.baseVersion === 2,
    );
    expect(v1Signs.length).toBe(2); // 员工、主管在 v1 上的签名（后被补页作废）
    expect(v2Signs.length).toBe(3); // 三方在 v2 上的重签
  });
});
