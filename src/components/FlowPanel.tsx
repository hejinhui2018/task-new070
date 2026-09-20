import { deriveSigners } from '../engine/engine';
import { shortHash } from '../engine/hash';
import { ACTOR_META } from '../engine/labels';
import type { EngineState, IntentTemplate } from '../engine/types';

const PHASE_LABEL: Record<string, string> = {
  waiting: '等待前序',
  current: '轮到 TA',
  'signed-valid': '已签署 · 有效',
  'signed-stale': '已签署 · 已失效',
  declined: '已拒签',
};

interface Props {
  engine: EngineState;
  onAction: (tpl: IntentTemplate) => void;
}

export default function FlowPanel({ engine, onAction }: Props) {
  const views = deriveSigners(engine);
  return (
    <section className="panel flow-panel">
      <h2>
        签署顺序 <span className="h-sub">顺序守卫：必须按 ① → ② → ③ 依次签署；按钮始终可点，违规动作会被拒收并给出原因</span>
      </h2>
      <div className="signers">
        {views.map((v, i) => {
          const meta = ACTOR_META[v.role];
          return (
            <div key={v.role} className={`signer-card phase-${v.phase}`}>
              <div className="signer-head">
                <span className="step-no">{i + 1}</span>
                <div className="signer-name">
                  <strong>{meta.label}</strong>
                  <span className={`kind kind-${meta.kind}`}>
                    {meta.kind === 'internal' ? '内部' : meta.kind === 'external' ? '外部' : ''}
                  </span>
                </div>
                <span className={`phase-chip phase-chip-${v.phase}`}>{PHASE_LABEL[v.phase]}</span>
              </div>
              <div className="signer-facts">
                <span className={`fact ${v.identityConfirmed ? 'ok' : ''}`} title={meta.auth}>
                  {v.identityConfirmed ? '✓' : '○'} 身份确认
                  <small>{meta.auth}</small>
                </span>
                <span className={`fact ${v.viewedCurrent ? 'ok' : ''}`}>
                  {v.viewedCurrent ? '✓' : '○'} 查阅 v{engine.doc.version}
                </span>
                {v.signature && (
                  <span
                    className={`fact mono ${v.sigValid ? 'ok' : 'warn'}`}
                    title={v.invalidReason ?? '签名绑定当前指纹'}
                  >
                    {v.sigValid ? '✓' : '⚠'} 签名绑定 v{v.signature.docVersion} · {shortHash(v.signature.fingerprint)} ·
                    链 {shortHash(v.signature.chainHash)}
                  </span>
                )}
              </div>
              {v.invalidReason && <div className="invalid-reason">✗ {v.invalidReason}</div>}
              <div className="signer-actions">
                <button onClick={() => onAction({ type: 'view', actor: v.role })}>查阅</button>
                <button onClick={() => onAction({ type: 'confirm_identity', actor: v.role })}>确认身份</button>
                <button className="primary" onClick={() => onAction({ type: 'sign', actor: v.role })}>
                  签署
                </button>
                <button
                  className="danger"
                  onClick={() => onAction({ type: 'decline', actor: v.role, note: '条款需修订' })}
                >
                  拒签
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
