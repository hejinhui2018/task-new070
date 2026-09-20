import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dispatch, verifyChain } from './engine/engine';
import { SCENARIOS } from './engine/scenarios';
import { clearSim, freshSim, HISTORY_CAP, loadSim, saveSim, type SimState } from './engine/storage';
import type { DispatchOptions, IntentTemplate } from './engine/types';
import CompareStrip from './components/CompareStrip';
import ControlPanel from './components/ControlPanel';
import DocPanel from './components/DocPanel';
import FlowPanel from './components/FlowPanel';
import HeaderBar from './components/HeaderBar';
import LogPanel from './components/LogPanel';

export interface Faults {
  lag: boolean;
  dup: boolean;
  stale: boolean;
}

export default function App() {
  const [boot] = useState(loadSim);
  const [sim, setSim] = useState<SimState>(boot.sim);
  const [notice, setNotice] = useState<string | null>(boot.notice);
  const [playing, setPlaying] = useState(false);
  const [faults, setFaults] = useState<Faults>({ lag: false, dup: false, stale: false });

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === sim.scenarioId) ?? SCENARIOS[0],
    [sim.scenarioId],
  );

  const doRun = useCallback((tpl: IntentTemplate, opts: DispatchOptions, advanceScenario: boolean) => {
    setSim((prev) => ({
      ...prev,
      past: [...prev.past.slice(-(HISTORY_CAP - 1)), { engine: prev.engine, stepIndex: prev.stepIndex }],
      future: [],
      engine: dispatch(prev.engine, tpl, opts),
      stepIndex: advanceScenario ? prev.stepIndex + 1 : prev.stepIndex,
    }));
  }, []);

  // 故障注入经 ref 读取，保证自动播放的定时器里也能拿到最新武装状态
  const faultsRef = useRef(faults);
  faultsRef.current = faults;

  const execute = useCallback(
    (tpl: IntentTemplate, opts: DispatchOptions = {}, advanceScenario = false) => {
      const f = faultsRef.current;
      const merged: DispatchOptions = { ...opts };
      if (f.lag) merged.lag = Math.max(merged.lag ?? 0, 3);
      if (f.dup) merged.copies = Math.max(merged.copies ?? 1, 2);
      const finalTpl = f.stale && tpl.type === 'sign' ? { ...tpl, staleClient: true } : tpl;
      if (f.lag || f.dup || f.stale) setFaults({ lag: false, dup: false, stale: false });
      doRun(finalTpl, merged, advanceScenario);
    },
    [doRun],
  );

  const runNextStep = useCallback(() => {
    const step = scenario.steps[sim.stepIndex];
    if (!step) return;
    execute(step.tpl, { lag: step.lag, copies: step.copies, advance: step.advance }, true);
  }, [scenario, sim.stepIndex, execute]);

  const runNextRef = useRef(runNextStep);
  runNextRef.current = runNextStep;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => runNextRef.current(), 900);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (playing && sim.stepIndex >= scenario.steps.length) setPlaying(false);
  }, [playing, sim.stepIndex, scenario.steps.length]);

  useEffect(() => {
    const t = window.setTimeout(() => saveSim(sim), 120);
    return () => window.clearTimeout(t);
  }, [sim]);

  const undo = useCallback(() => {
    setSim((prev) => {
      const last = prev.past[prev.past.length - 1];
      if (!last) return prev;
      return {
        ...prev,
        past: prev.past.slice(0, -1),
        future: [{ engine: prev.engine, stepIndex: prev.stepIndex }, ...prev.future].slice(0, HISTORY_CAP),
        engine: last.engine,
        stepIndex: last.stepIndex,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setSim((prev) => {
      const next = prev.future[0];
      if (!next) return prev;
      return {
        ...prev,
        past: [...prev.past, { engine: prev.engine, stepIndex: prev.stepIndex }].slice(-HISTORY_CAP),
        future: prev.future.slice(1),
        engine: next.engine,
        stepIndex: next.stepIndex,
      };
    });
  }, []);

  const resetAll = useCallback(() => {
    clearSim();
    setPlaying(false);
    setSim((prev) => freshSim(prev.scenarioId));
    setNotice('已重置：新的演练从草稿状态开始');
  }, []);

  const loadScenario = useCallback((id: string) => {
    setPlaying(false);
    setSim(freshSim(id));
    setNotice(null);
  }, []);

  const chain = useMemo(() => verifyChain(sim.engine), [sim.engine]);
  const engine = sim.engine;

  return (
    <div className="app">
      <HeaderBar
        engine={engine}
        chainOk={chain.ok}
        canUndo={sim.past.length > 0}
        canRedo={sim.future.length > 0}
        onUndo={undo}
        onRedo={redo}
        onReset={resetAll}
      />
      {notice && (
        <div className="banner">
          <span>{notice}</span>
          <button className="banner-close" onClick={() => setNotice(null)} aria-label="关闭">
            ×
          </button>
        </div>
      )}
      <div className="main">
        <DocPanel engine={engine} />
        <FlowPanel engine={engine} onAction={execute} />
        <ControlPanel
          engine={engine}
          scenario={scenario}
          stepIndex={sim.stepIndex}
          playing={playing}
          faults={faults}
          canUndo={sim.past.length > 0}
          canRedo={sim.future.length > 0}
          onSelectScenario={loadScenario}
          onStep={runNextStep}
          onTogglePlay={() => setPlaying((p) => !p)}
          onRestartScenario={() => loadScenario(scenario.id)}
          onAction={execute}
          onToggleFault={(key) => setFaults((f) => ({ ...f, [key]: !f[key] }))}
          onUndo={undo}
          onRedo={redo}
          onReset={resetAll}
        />
      </div>
      <CompareStrip engine={engine} />
      <LogPanel engine={engine} chainOk={chain.ok} mismatchAt={chain.mismatchAt} />
    </div>
  );
}
