import { remainingTicks } from '../engine/engine';
import { shortHash } from '../engine/hash';
import { STATUS_LABEL } from '../engine/labels';
import type { EngineState } from '../engine/types';

interface Props {
  engine: EngineState;
  chainOk: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}

export default function HeaderBar({ engine, chainOk, canUndo, canRedo, onUndo, onRedo, onReset }: Props) {
  const remaining = remainingTicks(engine);
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">⇄</span>
        <div>
          <h1>SignFlow · 签署流程验收台</h1>
          <p>文件指纹 × 顺序守卫 × 证据链 — 法务演练环境</p>
        </div>
      </div>
      <div className="header-meta">
        <span className="chip">信封 #{engine.envelopeId}</span>
        <span className={`chip status-${engine.status}`}>{STATUS_LABEL[engine.status]}</span>
        {remaining !== null && (
          <span className={`chip ${remaining <= 3 ? 'chip-warn' : ''}`}>剩余 {remaining} tick</span>
        )}
        <span className="chip mono">tick {engine.tick}</span>
        <span className="chip mono" title={`证据链头哈希：${engine.headHash}`}>
          链头 {shortHash(engine.headHash)}
        </span>
        <span className={`chip ${chainOk ? 'chip-ok' : 'chip-bad'}`}>{chainOk ? '链校验 ✓' : '链校验 ✗'}</span>
      </div>
      <div className="header-actions">
        <button onClick={onUndo} disabled={!canUndo} title="撤销上一步">
          ↩ 撤销
        </button>
        <button onClick={onRedo} disabled={!canRedo} title="重做">
          ↪ 重做
        </button>
        <button className="danger" onClick={onReset} title="清空并重新开始">
          ⟲ 重置
        </button>
      </div>
    </header>
  );
}
