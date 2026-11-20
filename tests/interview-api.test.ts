import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApiServer } from '../src/http/api.ts';
import { JsonStore } from '../src/store/json-store.ts';

test('interview API covers multiple rounds, privacy, agenda, calendar, feedback, rescheduling and cleanup', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'interview-api-'));
  const store = new JsonStore(join(directory, 'data.json'));
  await store.init();
  let clock = new Date('2026-11-20T10:00:00.000Z');
  const server = createApiServer({ store, jwtSecret: 'interview-integration-secret', now: () => clock });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  let token = '';
  async function request(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { response, status: response.status,
      body: response.headers.get('content-type')?.startsWith('application/json') && text ? JSON.parse(text) : text };
  }
  async function login() {
    token = (await request('/api/auth/login', 'POST', { email: 'one@example.com', password: 'password-one' }, '')).body.token;
  }
  try {
    token = (await request('/api/auth/register', 'POST', { email: 'one@example.com', password: 'password-one' })).body.token;
    const otherToken = (await request('/api/auth/register', 'POST', { email: 'two@example.com', password: 'password-two' }, '')).body.token;
    const application = (await request('/api/applications', 'POST', { company: 'Example', role: 'Engineer' })).body.application;
    const path = `/api/applications/${application.id}/interviews`;
    const input = { roundType: 'Technical', interviewerName: 'Person', startsAt: '2026-11-21T10:00:00.000Z', durationMinutes: 60 };
    const first = await request(path, 'POST', input);
    assert.equal(first.status, 201);
    const id = first.body.interviewRound.id;
    assert.equal((await request(path, 'POST', { ...input, roundType: 'HR', startsAt: '2026-11-28T10:00:00.000Z' })).status, 201);
    assert.equal((await request(path)).body.interviewRounds.length, 2);
    assert.equal((await request(`${path}/${id}`)).body.interviewRound.id, id);
    assert.equal((await request('/api/interviews/agenda')).body.interviewRounds.length, 1);
    const all = (await request('/api/interviews/agenda?days=all')).body.interviewRounds;
    assert.equal(all.length, 2);
    assert.equal(all[1].withinNext7Days, false);
    assert.equal((await request('/api/interviews/agenda?days=bad')).status, 400);
    assert.equal((await request(path, 'POST', { ...input, startsAt: 'bad' })).status, 400);
    assert.equal((await request(path, 'POST', { ...input, durationMinutes: '60' })).status, 400);
    assert.equal((await request(`${path}/${id}`, 'PATCH', { status: 'PASSED' })).status, 400);
    for (const [url, method, body] of [
      [path, 'GET', undefined], [path, 'POST', input],
      [`${path}/${id}`, 'PATCH', { feedbackNotes: 'No' }],
      [`${path}/${id}`, 'DELETE', undefined], [`${path}/${id}/calendar.ics`, 'GET', undefined],
    ] as const) {
      assert.equal((await request(url, method, body, otherToken)).status, 404);
      assert.equal((await request(url, method, body, '')).status, 401);
    }
    assert.deepEqual((await request('/api/interviews/agenda', 'GET', undefined, otherToken)).body.interviewRounds, []);
    const calendar = await request(`${path}/${id}/calendar.ics`);
    assert.equal(calendar.status, 200);
    assert.match(calendar.response.headers.get('content-type')!, /text\/calendar/);
    assert.match(calendar.response.headers.get('content-disposition')!, /attachment.*\.ics/);
    assert.ok(calendar.body.includes('DTSTART:20261121T100000Z'));
    assert.ok(calendar.body.includes('TRIGGER:-PT15M'));
    assert.equal((await request(`${path}/${id}`, 'PATCH', { startsAt: '2026-11-22T10:00:00.000Z' })).status, 200);
    assert.ok((await request(`${path}/${id}/calendar.ics`)).body.includes('DTSTART:20261122T100000Z'));
    const malformed = await fetch(base + path, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{bad json',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
    assert.equal((await request(`${path}/${id}/calendar.ics`, 'POST', {})).status, 405);
    clock = new Date('2026-11-22T11:00:00.000Z');
    await login();
    const feedback = await request(`${path}/${id}`, 'PATCH', {
      status: 'PASSED', feedbackNotes: 'Discussed algorithms', salaryInsights: 'Range discussed',
    });
    assert.equal(feedback.status, 200);
    assert.equal(feedback.body.interviewRound.status, 'PASSED');
    assert.equal((await request(path)).body.interviewRounds[0].salaryInsights, 'Range discussed');
    assert.equal((await request(`${path}/${id}`, 'PATCH', { startsAt: '2026-11-24T10:00:00.000Z' })).status, 400);
    await request(`/api/applications/${application.id}`, 'PATCH', { status: 'REJECTED' });
    assert.deepEqual((await request('/api/interviews/agenda?days=all')).body.interviewRounds, []);
    assert.equal((await request(path, 'POST', { ...input, startsAt: '2026-11-24T10:00:00.000Z' })).status, 400);
    assert.equal((await request(`${path}/${id}`, 'PATCH', { feedbackNotes: 'Updated after closure' })).status, 200);
    assert.equal((await request(`${path}/${id}`, 'DELETE')).status, 204);
    assert.equal((await request(`${path}/${id}/calendar.ics`)).status, 404);
    await request(`/api/applications/${application.id}`, 'DELETE');
    assert.equal((await request(path)).status, 404);
    assert.deepEqual(await store.listInterviewAgenda(feedback.body.interviewRound.userId, clock, null), []);
    assert.deepEqual(await store.listInterviewRounds(feedback.body.interviewRound.userId, application.id), []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});