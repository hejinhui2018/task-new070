import type { Faults } from '../App';
import { ACTOR_META, TYPE_LABEL } from '../engine/labels';
import { SCENARIOS } from '../engine/scenarios';
import type { DispatchOptions, EngineState, IntentTemplate, Scenario } from '../engine/types';

interface Props {
  engine: EngineState;
  scenario: Scenario;
  stepIndex: number;
  playing: boolean;
  faults: Faults;
  canUndo: boolean;
  canRedo: boolean;
  onSelectScenario: (id: string) => void;
  onStep: () => void;
  onTogglePlay: () => void;
  onRestartScenario: () => void;
  onAction: (tpl: IntentTemplate, opts?: DispatchOptions) => void;
  onToggleFault: (key: keyof Faults) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}

export default function ControlPanel(props: Props) {
  const { engine, scenario, stepIndex, playing, faults } = props;
  const done = stepIndex >= scenario.steps.length;
  const armed = [faults.lag && '延迟', faults.dup && '重复', faults.stale && '旧版'].filter(Boolean).join(' + ');

  return (
    <aside className="panel control-panel">
      <h2>演练控制台</h2>

      <section className="ctrl-section">
        <h3>剧本</h3>
        <div className="scenario-list">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`scenario-btn ${s.id === scenario.id ? 'active' : ''}`}
              onClick={() => props.onSelectScenario(s.id)}
              title={s.desc}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="scenario-desc">{scenario.desc}</p>
        <div className="progress">
          <div
            className="progress-bar"
            style={{ width: `${(Math.min(stepIndex, scenario.steps.length) / scenario.steps.length) * 100}%` }}
          />
        </div>
        <div className="progress-text">
          步骤 {Math.min(stepIndex, scenario.steps.length)}/{scenario.steps.length}
          {done ? ' · 剧本已执行完' : ` · 下一步：${scenario.steps[stepIndex].label}`}
        </div>
        <div className="btn-row">
          <button className="primary" onClick={props.onStep} disabled={done}>
            ▶ 单步
          </button>
          <button onClick={props.onTogglePlay} disabled={done && !playing}>
            {playing ? '⏸ 暂停' : '⏵ 自动播放'}
          </button>
          <button onClick={props.onRestartScenario}>⟲ 重跑剧本</button>
        </div>
      </section>

      <section className="ctrl-section">
        <h3>发件人操作</h3>
        <div className="btn-grid">
          <button onClick={() => props.onAction({ type: 'send', actor: 'sender' })}>发送信封</button>
          <button onClick={() => props.onAction({ type: 'replace_doc', actor: 'sender' })}>补页换版</button>
          <button onClick={() => props.onAction({ type: 'withdraw', actor: 'sender' })}>撤回信封</button>
          <button onClick={() => props.onAction({ type: 'reinitiate', actor: 'sender' })}>重新发起</button>
          <button
            onClick={() => props.onAction({ type: 'submit_check', actor: 'sender' })}
            title="模拟旧系统：提交时才校验签名与版本的一致性"
          >
            提交校验
          </button>
          <button onClick={() => props.onAction({ type: 'wait', actor: 'system' })}>推进 1 tick</button>
          <button onClick={() => props.onAction({ type: 'wait', actor: 'system' }, { advance: 4 })}>
            推进 5 tick
          </button>
        </div>
      </section>

      <section className="ctrl-section">
        <h3>
          故障注入 <span className="h-sub">武装后作用于下一次操作，用后失效</span>
        </h3>
        <div className="btn-grid">
          <button className={faults.lag ? 'armed' : ''} onClick={() => props.onToggleFault('lag')}>
            回执延迟 +3 tick
          </button>
          <button className={faults.dup ? 'armed' : ''} onClick={() => props.onToggleFault('dup')}>
            回执重复投递 ×2
          </button>
          <button
            className={faults.stale ? 'armed' : ''}
            disabled={engine.docHistory.length === 0}
            title={engine.docHistory.length === 0 ? '需要先做一次补页换版' : '以旧版本指纹签署'}
            onClick={() => props.onToggleFault('stale')}
          >
            旧版客户端签署
          </button>
        </div>
        {armed && <p className="armed-note">已武装：{armed}</p>}
      </section>

      <section className="ctrl-section">
        <h3>
          在途回执 {engine.inFlight.length > 0 && <span className="count">{engine.inFlight.length}</span>}
        </h3>
        {engine.inFlight.length === 0 ? (
          <p className="empty">无（注入「回执延迟」或运行晚到剧本后产生）</p>
        ) : (
          <ul className="inflight-list">
            {engine.inFlight.map((f) => (
              <li key={f.intent.receiptId}>
                <span className="mono">{f.intent.receiptId}</span> {ACTOR_META[f.intent.actor].short} ·{' '}
                {TYPE_LABEL[f.intent.type]} · 基于 v{f.intent.baseVersion}
                <span className="eta">
                  tick {f.deliverAtTick} 到达（还有 {Math.max(0, f.deliverAtTick - engine.tick)} tick）
                  {f.copiesLeft > 0 ? ` · 共 ${f.copiesLeft + 1} 份` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ctrl-section">
        <h3>历史</h3>
        <div className="btn-row">
          <button onClick={props.onUndo} disabled={!props.canUndo}>
            ↩ 撤销
          </button>
          <button onClick={props.onRedo} disabled={!props.canRedo}>
            ↪ 重做
          </button>
          <button className="danger" onClick={props.onReset}>
            ⟲ 重置全部
          </button>
        </div>
      </section>
    </aside>
  );
}
