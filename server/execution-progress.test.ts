import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExecutionProgressTracker, ExecutionProgressWriter, readExecutionProgress } from './execution-progress.ts';

const start = '2026-10-26T13:00:00.000Z', end = '2026-10-26T13:00:02.000Z';
test('progress tracks parallel actions, counts failures once, and excludes private payloads', () => {
  const tracker = new ExecutionProgressTracker(start);
  assert.equal(tracker.accept({ type: 'item.completed', item: { id: 'private', type: 'reasoning', text: 'private reasoning' } }), false);
  assert.equal(tracker.accept(null), false);
  tracker.accept({ type: 'item.started', item: { id: 'one', type: 'command_execution', command: 'apply_patch SECRET_ENV=private' } }, start);
  tracker.accept({ type: 'item.started', item: { id: 'two', type: 'mcp_tool_call', server: 'private', tool: 'imagegen', arguments: { secret: 'private' } } }, start);
  assert.deepEqual(tracker.snapshot().activeActions.map(action => action.label), ['写入网页文件', '生成图片']);
  const failure = { type: 'item.completed', item: { id: 'one', type: 'command_execution', exit_code: 1, aggregated_output: 'private' } };
  tracker.accept(failure, end); tracker.accept(failure, end);
  tracker.accept({ type: 'item.completed', item: { id: 'two', type: 'mcp_tool_call', status: 'completed' } }, end);
  assert.equal(tracker.snapshot().completedActions, 1);
  assert.equal(tracker.snapshot().failedActions, 1);
  assert.equal(tracker.snapshot().activeActions.length, 0);
  assert(!JSON.stringify(tracker.snapshot()).includes('private'));
});

test('actual collab_tool_call states track spawn, completion, failure and closure', () => {
  const tracker = new ExecutionProgressTracker(start);
  tracker.accept({ type: 'item.completed', item: { id: 'spawn', type: 'collab_tool_call', tool: 'spawn_agent', status: 'completed', receiver_thread_ids: ['agent-1'], prompt: 'private task', agents_states: { 'agent-1': { status: 'running', message: 'private output' } } } });
  tracker.accept({ type: 'item.completed', item: { id: 'wait', type: 'collab_tool_call', tool: 'wait', status: 'completed', receiver_thread_ids: ['agent-1', 'agent-2'], agents_states: { 'agent-1': { status: 'completed' }, 'agent-2': { status: 'errored' } } } });
  tracker.accept({ type: 'item.completed', item: { id: 'spawn3', type: 'collab_tool_call', tool: 'spawn_agent', status: 'completed', receiver_thread_ids: ['agent-3'] } });
  tracker.accept({ type: 'item.completed', item: { id: 'close3', type: 'collab_tool_call', tool: 'close_agent', status: 'completed', receiver_thread_ids: ['agent-3'], agents_states: { 'agent-3': { status: 'shutdown' } } } });
  assert.deepEqual(tracker.snapshot().agents.map(agent => agent.status), ['completed', 'failed', 'closed']);
  assert(!JSON.stringify(tracker.snapshot()).includes('private'));
});

test('progress projection is bounded and finishing clears unfinished work without claiming success', () => {
  const tracker = new ExecutionProgressTracker(start);
  for (let i = 0; i < 100; i++) tracker.accept({ type: 'item.started', item: { id: `action-${i}`, type: 'command_execution', command: 'echo private' } });
  assert.equal(tracker.snapshot().activeActions.length, 16);
  tracker.accept({ type: 'item.completed', item: { type: 'agent_message', text: 'api_key=supersecret\n```private command```' } });
  assert(!tracker.snapshot().message.includes('supersecret'));
  assert(!tracker.snapshot().message.includes('private'));
  tracker.finish('cancelled', end);
  assert.equal(tracker.snapshot().activeActions.length, 0);
  assert.equal(tracker.snapshot().completedActions, 0);
  assert.equal(tracker.snapshot().updatedAt, end);
});

test('atomic writer coalesces updates, flushes final state, and reader rejects invalid files', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pretty-progress-'));
  try {
    assert.equal(await readExecutionProgress(cwd), undefined);
    const tracker = new ExecutionProgressTracker(start), writer = new ExecutionProgressWriter(cwd, 1);
    for (let i = 0; i < 100; i++) {
      tracker.accept({ type: 'item.completed', item: { id: `action-${i}`, type: 'command_execution', exit_code: 0 } });
      writer.schedule(tracker.snapshot());
    }
    tracker.finish('completed', end); await writer.close(tracker.snapshot());
    const actual = await readExecutionProgress(cwd);
    assert.deepEqual(actual, tracker.snapshot());
    assert.equal(JSON.parse(await readFile(path.join(cwd, 'progress.json'), 'utf8')).completedActions, 100);
    await writeFile(path.join(cwd, 'progress.json'), '{half-written');
    assert.equal(await readExecutionProgress(cwd), undefined);
    await writeFile(path.join(cwd, 'progress.json'), JSON.stringify({ ...tracker.snapshot(), private: 'do not leak', failedActions: -5, activeActions: [{ id: '<unsafe>', label: 'private', startedAt: start }], agents: [{ id: 'agent-1', label: 'private prompt', status: 'running' }] }));
    const projected = await readExecutionProgress(cwd);
    assert.equal(projected?.failedActions, 0);
    assert.equal(projected?.activeActions.length, 0);
    assert.equal(projected?.agents[0].label, '子代理 1');
    assert(!JSON.stringify(projected).includes('private'));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
