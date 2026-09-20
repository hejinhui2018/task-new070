import { useEffect, useRef } from 'react';
import { shortHash } from '../engine/hash';
import { ACTOR_META, TYPE_LABEL, VERDICT_LABEL } from '../engine/labels';
import type { EngineState } from '../engine/types';

interface Props {
  engine: EngineState;
  chainOk: boolean;
  mismatchAt: number | null;
}

export default function LogPanel({ engine, chainOk, mismatchAt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [engine.log.length]);

  return (
    <section className="panel log-panel">
      <h2>
        证据链日志
        <span className="h-sub">{engine.log.length} 条 · 每条绑定：前序哈希 + 文件指纹 + 回执编号</span>
        <span className={`chip ${chainOk ? 'chip-ok' : 'chip-bad'}`}>
          {chainOk ? '链校验 ✓' : `链校验 ✗（第 ${mismatchAt} 条）`}
        </span>
      </h2>
      <div className="log-scroll" ref={ref}>
        {engine.log.length === 0 && (
          <p className="empty">暂无记录 — 从「发送信封」开始，或选择一个剧本单步执行。</p>
        )}
        {engine.log.map((e) => (
          <div key={e.seq} className={`log-row verdict-${e.verdict}`}>
            <span className="log-seq mono">#{e.seq}</span>
            <span className="log-tick mono">t{e.tick}</span>
            <span className="log-actor">{ACTOR_META[e.intent.actor].short}</span>
            <span className="log-type">{TYPE_LABEL[e.intent.type]}</span>
            <span className={`log-verdict verdict-chip-${e.verdict}`}>{VERDICT_LABEL[e.verdict]}</span>
            <span className="log-reason" title={e.reason}>
              {e.reason}
            </span>
            <span className="log-hash mono" title={`前序 ${e.prevHash}\n本条 ${e.hash}`}>
              {shortHash(e.prevHash)} → {shortHash(e.hash)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
