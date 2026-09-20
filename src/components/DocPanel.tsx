import { shortHash } from '../engine/hash';
import type { EngineState } from '../engine/types';

export default function DocPanel({ engine }: { engine: EngineState }) {
  const { doc, docHistory } = engine;
  const prevCount = docHistory.length > 0 ? docHistory[docHistory.length - 1].pages.length : doc.pages.length;
  const boundCount = (fp: string) =>
    engine.log.filter((e) => e.intent.type === 'sign' && e.verdict === 'applied' && e.intent.baseFingerprint === fp)
      .length;

  return (
    <aside className="panel doc-panel">
      <h2>文件与版本</h2>
      <div className="doc-card">
        <div className="doc-title">{doc.title}</div>
        <div className="doc-version-row">
          <span className="doc-version">v{doc.version}</span>
          <span className="mono fingerprint" title={doc.fingerprint}>
            指纹 {shortHash(doc.fingerprint)}
          </span>
        </div>
        <div className="doc-note">
          {doc.note} · 发布于 tick {doc.issuedAtTick}
        </div>
        <div className="pages">
          {doc.pages.map((p, i) => (
            <div key={`${doc.version}-${i}`} className={`page ${i >= prevCount ? 'page-new' : ''}`} title={p}>
              <span className="page-no">{i + 1}</span>
              <span className="page-name">{p}</span>
              {i >= prevCount && <span className="page-badge">新</span>}
            </div>
          ))}
        </div>
      </div>
      <h3>版本历史</h3>
      <div className="version-list">
        {[...docHistory].reverse().map((v) => (
          <div key={v.version} className="version-item replaced">
            <div className="version-head">
              <span>v{v.version}</span>
              <span className="mono">{shortHash(v.fingerprint)}</span>
            </div>
            <div className="version-sub">
              {v.pages.length} 页 · 已被 v{v.version + 1} 替换 · {boundCount(v.fingerprint)} 处签名绑定此指纹
            </div>
          </div>
        ))}
        <div className="version-item current">
          <div className="version-head">
            <span>v{doc.version}</span>
            <span className="mono">{shortHash(doc.fingerprint)}</span>
          </div>
          <div className="version-sub">
            {doc.pages.length} 页 · 当前版本 · {boundCount(doc.fingerprint)} 处签名绑定此指纹
          </div>
        </div>
      </div>
      <p className="panel-hint">签署只认「查阅时的指纹」。补页换版后，绑定旧指纹的签名即时失效，见右侧流程与底部对比条。</p>
    </aside>
  );
}
