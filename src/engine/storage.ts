import { initialState, verifyChain } from './engine';
import type { EngineState } from './types';

export interface Snapshot {
  engine: EngineState;
  stepIndex: number;
}

export interface SimState {
  engine: EngineState;
  scenarioId: string;
  stepIndex: number;
  past: Snapshot[];
  future: Snapshot[];
}

export const HISTORY_CAP = 40;
const KEY = 'signflow:sim:v1';

export function freshSim(scenarioId = 'happy'): SimState {
  return { engine: initialState(), scenarioId, stepIndex: 0, past: [], future: [] };
}

export function loadSim(): { sim: SimState; notice: string | null } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { sim: freshSim(), notice: null };
    const parsed = JSON.parse(raw) as SimState;
    if (!parsed || typeof parsed !== 'object' || !parsed.engine || !Array.isArray(parsed.engine.log)) {
      throw new Error('snapshot shape invalid');
    }
    const check = verifyChain(parsed.engine);
    if (!check.ok) {
      return {
        sim: freshSim(),
        notice: `本地快照的证据链校验失败（第 ${check.mismatchAt ?? '?'} 条起不一致），已重置为新演练`,
      };
    }
    const sim: SimState = {
      engine: parsed.engine,
      scenarioId: typeof parsed.scenarioId === 'string' ? parsed.scenarioId : 'happy',
      stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0,
      past: Array.isArray(parsed.past) ? parsed.past.slice(-HISTORY_CAP) : [],
      future: Array.isArray(parsed.future) ? parsed.future.slice(0, HISTORY_CAP) : [],
    };
    return {
      sim,
      notice: `已从本地快照恢复：信封 #${sim.engine.envelopeId} · tick ${sim.engine.tick} · 证据链 ${sim.engine.log.length} 条 · 链校验通过 ✓`,
    };
  } catch {
    return { sim: freshSim(), notice: '本地快照读取失败（数据损坏），已重置为新演练' };
  }
}

export function saveSim(sim: SimState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sim));
  } catch {
    // 存储被禁用或已满时静默失败——演练本身不依赖持久化
  }
}

export function clearSim(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
