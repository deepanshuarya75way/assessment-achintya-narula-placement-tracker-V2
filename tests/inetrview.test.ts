import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplication } from '../src/domain/application.ts';
import { createInterviewRound, updateInterviewRound } from '../src/domain/interview.ts';
import { JsonStore } from '../src/store/json-store.ts';

const now = new Date('2026-11-20T10:00:00.000Z');
const after = new Date('2026-11-21T11:00:00.000Z');
const input = {
  roundType: ' Technical ',
  startsAt: '2026-11-21T10:00:00.000Z',
  interviewerName: ' Interviewer ',
};

test('creates a normalized future interview with default duration', () => {
  const round = createInterviewRound(input, 'owner', 'app', now);
  assert.equal(round.roundType, 'Technical');
  assert.equal(round.interviewerName, 'Interviewer');
  assert.equal(round.durationMinutes, 60);
  assert.equal(round.status, 'SCHEDULED');
  assert.equal(round.userId, 'owner');
  assert.equal(round.applicationId, 'app');
  assert.equal(round.feedbackNotes, '');
  assert.notEqual(round.id, createInterviewRound(input, 'owner', 'app', now).id);
});

test('rejects malformed dates, past interviews and invalid input', () => {
  for (const startsAt of [undefined, '', 'bad', '2026-02-30T10:00:00.000Z',
    '2026-11-21T10:00:00', '2026-11-21T10:00:00+05:30', now.toISOString()]) {
    assert.throws(() => createInterviewRound({ ...input, startsAt }, 'owner', 'app', now));
  }
  for (const durationMinutes of [0, 481, -1, 1.5, '60', null, NaN]) {
    assert.throws(() => createInterviewRound({ ...input, durationMinutes }, 'owner', 'app', now));
  }
  for (const field of ['roundType', 'interviewerName']) {
    for (const value of ['', '  ', 5, 'a'.repeat(201)]) {
      assert.throws(() => createInterviewRound({ ...input, [field]: value }, 'owner', 'app', now));
    }
  }
});

test('validates post-interview feedback and preserves omitted notes', () => {
  const round = createInterviewRound(input, 'owner', 'app', now);
  assert.throws(() => updateInterviewRound(round, { status: 'PASSED' }, now), /after/);
  const completed = updateInterviewRound(round, {
    status: 'COMPLETED', feedbackNotes: ' Good discussion ', salaryInsights: ' Range discussed ',
  }, after);
  assert.equal(completed.feedbackNotes, 'Good discussion');
  const passed = updateInterviewRound(completed, { status: 'PASSED' }, after);
  assert.equal(passed.feedbackNotes, completed.feedbackNotes);
  assert.equal(passed.salaryInsights, completed.salaryInsights);
  assert.equal(updateInterviewRound(passed, { feedbackNotes: '' }, after).feedbackNotes, '');
  assert.throws(() => updateInterviewRound(passed, { status: 'SCHEDULED' }, after), /cannot return/);
  assert.throws(() => updateInterviewRound(round, { status: 'UNKNOWN' }, after), /invalid/);
  assert.throws(() => updateInterviewRound(round, { feedbackNotes: null }, after), /Notes/);
  assert.throws(() => updateInterviewRound(round, { salaryInsights: 'a'.repeat(5001) }, after), /Notes/);
});

test('reschedules only scheduled future rounds and preserves identity', () => {
  const round = createInterviewRound(input, 'owner', 'app', now);
  const updated = updateInterviewRound(round, {
    startsAt: '2026-11-23T10:00:00.000Z', durationMinutes: 90, interviewerName: 'Another person',
  }, now);
  assert.equal(updated.id, round.id);
  assert.equal(updated.createdAt, round.createdAt);
  assert.equal(updated.durationMinutes, 90);
  assert.equal(updated.interviewerName, 'Another person');
  assert.throws(() => updateInterviewRound(round, { startsAt: now.toISOString() }, now), /future/);
  assert.throws(() => updateInterviewRound(round, { startsAt: null }, now), /format/);
  const completed = updateInterviewRound(round, { status: 'COMPLETED' }, after);
  assert.throws(() => updateInterviewRound(completed, { interviewerName: 'Other' }, after), /finished/);
  assert.throws(() => createInterviewRound({ ...input, startsAt: '9999-12-31T23:30:00.000Z' }, 'owner', 'app', now), /calendar year/);
});

test('persists owner-scoped rounds, serializes feedback updates, and cascades deletes', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'interview-store-'));
  const file = join(directory, 'data.json');
  try {
    const store = new JsonStore(file);
    await store.init();
    await store.addApplication(createApplication({ company: 'Example', role: 'Engineer' }, 'owner', now, 'app'));
    const later = createInterviewRound({ ...input, startsAt: '2026-11-22T10:00:00.000Z' }, 'owner', 'app', now);
    const earlier = createInterviewRound(input, 'owner', 'app', now);
    assert.equal(await store.addInterviewRound('other', earlier), undefined);
    assert.equal(await store.addInterviewRound('owner', { ...earlier, userId: 'other' }), undefined);
    await Promise.all([store.addInterviewRound('owner', later), store.addInterviewRound('owner', earlier)]);
    await assert.rejects(store.addInterviewRound('owner', earlier), /already exists/);
    assert.deepEqual(await store.listInterviewRounds('other', 'app'), []);
    assert.equal(await store.updateInterviewRound('other', 'app', earlier.id, {}, after), undefined);
    assert.equal(await store.updateInterviewRound('owner', 'wrong-app', earlier.id, {}, after), undefined);
    await Promise.all([
      store.updateInterviewRound('owner', 'app', earlier.id, { feedbackNotes: 'Feedback' }, after),
      store.updateInterviewRound('owner', 'app', earlier.id, { salaryInsights: 'Salary' }, after),
    ]);
    const reopened = new JsonStore(file);
    await reopened.init();
    const rounds = await reopened.listInterviewRounds('owner', 'app');
    assert.deepEqual(rounds.map((round) => round.id), [earlier.id, later.id]);
    assert.equal(rounds[0].feedbackNotes, 'Feedback');
    assert.equal(rounds[0].salaryInsights, 'Salary');
    assert.equal(await store.deleteApplication('other', 'app'), false);
    assert.equal((await store.listInterviewRounds('owner', 'app')).length, 2);
    const application = await store.getApplication('owner', 'app');
    assert.ok(application);
    await store.replaceApplication('owner', { ...application, status: 'REJECTED' });
    await assert.rejects(store.addInterviewRound('owner', createInterviewRound(input, 'owner', 'app', now)), /closed/);
    await store.deleteApplication('owner', 'app');
    assert.deepEqual(await store.listInterviewRounds('owner', 'app'), []);
    assert.equal(await store.addInterviewRound('owner', earlier), undefined);
    assert.equal(await store.updateInterviewRound('owner', 'app', earlier.id, {}, after), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});