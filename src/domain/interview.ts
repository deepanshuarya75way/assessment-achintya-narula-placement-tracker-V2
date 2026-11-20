export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'PASSED';

export class InterviewValidationError extends Error {}

export interface InterviewRound {
  id: string;
  applicationId: string;
  userId: string;
  roundType: string;
  startsAt: string;
  durationMinutes: number;
  interviewerName: string;
  status: InterviewStatus;
  feedbackNotes: string;
  salaryInsights: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewInput {
  roundType?: unknown;
  startsAt?: unknown;
  durationMinutes?: unknown;
  interviewerName?: unknown;
}

export interface InterviewPatch extends InterviewInput {
  status?: unknown;
  feedbackNotes?: unknown;
  salaryInsights?: unknown;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InterviewValidationError(`${label} is required`);
  }

  const text = value.trim();

  if (text.length > 200) {
    throw new InterviewValidationError(`${label} must be 200 characters or fewer`);
  }

  return text;
}

function validStartAt(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new InterviewValidationError('Interview time must use ISO UTC format');
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== value
  ) {
    throw new InterviewValidationError('Interview time must use ISO UTC format');
  }

  return value;
}

function validDuration(value: unknown): number {
  const minutes = value === undefined ? 60 : value;

  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 480
  ) {
    throw new InterviewValidationError('Duration must be 1–480 whole minutes');
  }

  return minutes;
}

function normalizeSchedule(input: InterviewInput, now: Date) {
  const startsAt = validStartAt(input.startsAt);
  const durationMinutes = validDuration(input.durationMinutes);
  if (Date.parse(startsAt) <= now.getTime()) {
    throw new InterviewValidationError('Interview must be scheduled in the future');
  }
  if (new Date(Date.parse(startsAt) + durationMinutes * 60_000).getUTCFullYear() > 9999) {
    throw new InterviewValidationError('Interview end must be within a four-digit calendar year');
  }
  return {
    roundType: requiredText(input.roundType, 'Round type'),
    startsAt,
    durationMinutes,
    interviewerName: requiredText(input.interviewerName, 'Interviewer name'),
  };
}

export function createInterviewRound(
  input: InterviewInput,
  userId: string,
  applicationId: string,
  now = new Date(),
  id: string = crypto.randomUUID(),
): InterviewRound {
  const timestamp = now.toISOString();

  return {
    id,
    userId,
    applicationId,
    ...normalizeSchedule(input, now),
    status: 'SCHEDULED',
    feedbackNotes: '',
    salaryInsights: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function noteText(value: unknown, existing: string): string {
  if (value === undefined) return existing;

  if (typeof value !== 'string' || value.length > 5000) {
    throw new InterviewValidationError('Notes must be text of at most 5000 characters');
  }

  return value.trim();
}

export function updateInterviewRound(
  existing: InterviewRound,
  patch: InterviewPatch,
  now = new Date(),
): InterviewRound {
  let round = { ...existing };
  const scheduleChanged = ['roundType', 'startsAt', 'durationMinutes', 'interviewerName']
    .some((key) => Object.hasOwn(patch, key));
  if (scheduleChanged) {
    if (existing.status !== 'SCHEDULED') {
      throw new InterviewValidationError('A finished round cannot be rescheduled');
    }
    const schedule = normalizeSchedule({
      roundType: patch.roundType === undefined ? existing.roundType : patch.roundType,
      startsAt: patch.startsAt === undefined ? existing.startsAt : patch.startsAt,
      durationMinutes: patch.durationMinutes === undefined ? existing.durationMinutes : patch.durationMinutes,
      interviewerName: patch.interviewerName === undefined ? existing.interviewerName : patch.interviewerName,
    }, now);
    round = { ...existing, ...schedule };
  }

  const status =
    patch.status === undefined ? existing.status : patch.status;

  if (
    status !== 'SCHEDULED' &&
    status !== 'COMPLETED' &&
    status !== 'PASSED'
  ) {
    throw new InterviewValidationError('Interview status is invalid');
  }

  if (status === 'SCHEDULED' && existing.status !== 'SCHEDULED') {
    throw new InterviewValidationError('A finished round cannot return to scheduled');
  }

  const recordingFeedback = (patch.status !== undefined && status !== 'SCHEDULED') ||
    patch.feedbackNotes !== undefined || patch.salaryInsights !== undefined;
  const endsAt = Date.parse(round.startsAt) + round.durationMinutes * 60_000;
  if (recordingFeedback && now.getTime() < endsAt) {
    throw new InterviewValidationError('Feedback can be recorded after the interview ends');
  }

  return {
    ...round,
    status,
    feedbackNotes: noteText(patch.feedbackNotes, existing.feedbackNotes),
    salaryInsights: noteText(patch.salaryInsights, existing.salaryInsights),
    updatedAt: now.toISOString(),
  };
}