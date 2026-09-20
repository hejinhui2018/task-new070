import { deriveSigners } from '../engine/engine';
import { ACTOR_META } from '../engine/labels';
import type { EngineState } from '../engine/types';

export default function CompareStrip({ engine }: { engine: EngineState }) {
  const views = deriveSigners(engine);
  const divergence = views.filter((v) => v.legacyValid !== v.sigValid);
  const legacySubmitOk = views.every((v) => v.legacyValid) && engine.status === 'completed';

  return (
    <section className="compare-strip">
      <div className="compare-row">
        <span className="compare-label">
          旧系统视图
          <small>提交时才校验</small>
        </span>
        <div className="compare-chips">
          {views.map((v) => (
            <span key={v.role} className={`cmp-chip ${v.legacyValid ? 'ok' : 'na'}`}>
              {ACTOR_META[v.role].short} {v.legacyValid ? '✓ 有效' : '— 未签'}
            </span>
          ))}
        </div>
        <span className={`cmp-result ${legacySubmitOk ? 'ok' : divergence.length > 0 ? 'bad' : ''}`}>
          {legacySubmitOk ? '提交将通过' : divergence.length > 0 ? '提交才发现：整份需重签 ✗' : '等待签署'}
        </span>
      </div>
      <div className="compare-row">
        <span className="compare-label">
          链绑定视图
          <small>签署当下即校验</small>
        </span>
        <div className="compare-chips">
          {views.map((v) => (
            <span key={v.role} className={`cmp-chip ${v.sigValid ? 'ok' : v.signature ? 'bad' : 'na'}`}>
              {ACTOR_META[v.role].short} {v.sigValid ? '✓ 有效' : v.signature ? '✗ 已失效' : '— 待签'}
            </span>
          ))}
        </div>
        <span className="cmp-result ok">即时可见，无需等待提交</span>
      </div>
      {divergence.length > 0 && (
        <div className="divergence">
          ⚠ 视图分歧：旧系统仍显示 {divergence.length} 处有效签名（
          {divergence.map((v) => ACTOR_META[v.role].short).join('、')}
          ），实际已绑定旧版本指纹 —— 本台在变更当下即标出，避免提交时整份驳回。
        </div>
      )}
    </section>
  );
}
