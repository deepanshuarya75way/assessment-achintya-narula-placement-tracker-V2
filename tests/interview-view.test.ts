import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewPayload, interviewPresentation, localDateTime } from '../public/interview-view.js';

test('converts local form inputs to canonical UTC and numeric duration', () => {
  const values = { roundType: 'HR', interviewerName: 'Person', date: '2026-11-21', time: '14:30', durationMinutes: '60' };
  const result = interviewPayload(values);
  assert.equal(result.startsAt, new Date('2026-11-21T14:30').toISOString());
  assert.equal(localDateTime(result.startsAt), '2026-11-21T14:30');
  assert.equal(result.durationMinutes, 60);
  assert.throws(() => interviewPayload({ ...values, date: 'invalid' }), /valid date/);
  assert.throws(() => interviewPayload({ ...values, date: '2026-02-30' }), /valid date/);
});

test('feedback becomes available at the end time and completed rounds cannot be rescheduled', () => {
  const round = { startsAt: '2026-11-21T10:00:00.000Z', durationMinutes: 60, status: 'SCHEDULED' };
  assert.equal(interviewPresentation(round, new Date('2026-11-21T09:00:00.000Z')).canReschedule, true);
  assert.equal(interviewPresentation(round, new Date('2026-11-21T10:59:59.000Z')).canRecordFeedback, false);
  const after = interviewPresentation(round, new Date('2026-11-21T11:00:00.000Z'));
  assert.equal(after.canRecordFeedback, true);
  assert.equal(after.label, 'Awaiting feedback');
  assert.equal(interviewPresentation({ ...round, status: 'PASSED' }).canReschedule, false);
});