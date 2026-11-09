import * as path from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { configureFigures, figureSprites } from '../src/figures/index.js';
import { refreshSessionNames } from '../src/sessionNames.js';

// The bundled assets: Metro City layers + the char_5 pose donor.
const ASSETS = path.resolve(__dirname, '../../webview-ui/public');

beforeAll(() => configureFigures(ASSETS));

describe('generated figures', () => {
  it('compose the same sheet for a name however it is spelled, and differ between names', () => {
    const a = figureSprites('Dirigent');
    expect(a?.down).toHaveLength(7);
    expect(a?.down[0]).toHaveLength(32);
    expect(a?.down[0][0]).toHaveLength(16);
    expect(figureSprites(' DIRIGENT ')).toEqual(a);
    expect(figureSprites('Kistvakt')).not.toEqual(a);
  });

  it('lock at first sight: the first name seeds the figure, a rename keeps it, and it is persisted', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 's1',
        projectDir: '/p',
        jsonlFile: '/p/1.jsonl',
        isExternal: true,
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => sent.push(m));
    const persist = vi.spyOn(store, 'persist');
    const names = (n: string) => [
      { id: 'claude', sessionNames: () => new Map([['s1', n]]) } as unknown as HookProvider,
    ];

    refreshSessionNames(store, names('Dirigent'));
    refreshSessionNames(store, names('Dirigent 2'));

    expect(store.get(1)?.figureSeed).toBe('Dirigent');
    const figures = sent.filter((m) => m.type === 'agentFigure');
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ id: 1, seed: 'Dirigent' });
    expect(persist).toHaveBeenCalledTimes(1);

    const resent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => resent.push(m), store);
    expect(resent.find((m) => m.type === 'agentFigure')).toMatchObject({ id: 1, seed: 'Dirigent' });
  });
});
