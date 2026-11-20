export function interviewPayload(values) {
  const local = `${values.date}T${values.time}`;
  const date = new Date(local);
  if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== local) {
    throw new Error('Choose a valid date and time in your device timezone');
  }
  return {
    roundType: values.roundType,
    startsAt: date.toISOString(),
    durationMinutes: Number(values.durationMinutes),
    interviewerName: values.interviewerName,
  };
}

export function localDateTime(iso) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function interviewPresentation(round, now = new Date()) {
  const startsAt = new Date(round.startsAt);
  const endsAt = new Date(startsAt.getTime() + round.durationMinutes * 60_000);
  return {
    startsAt,
    endsAt,
    canReschedule: round.status === 'SCHEDULED' && startsAt > now,
    canRecordFeedback: endsAt <= now,
    label: round.status === 'SCHEDULED' && endsAt <= now
      ? 'Awaiting feedback' : round.status.toLowerCase(),
  };
}