const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19,800,000 ms (+05:30)

export function interviewPayload(values) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.date ?? '');
  const timeParts = /^(\d{2}):(\d{2})$/.exec(values.time ?? '');

  if (!dateParts || !timeParts) {
    throw new Error('Choose a valid date and time in IST');
  }

  const [, year, month, day] = dateParts.map(Number);
  const [, hours, minutes] = timeParts.map(Number);

  // Treat input components as UTC first, then subtract IST offset to get actual UTC timestamp
  const utcMs = Date.UTC(year, month - 1, day, hours, minutes) - IST_OFFSET_MS;
  const date = new Date(utcMs);
  const expectedLocal = `${values.date}T${values.time}`;

  if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== expectedLocal) {
    throw new Error('Choose a valid date and time in IST');
  }

  return {
    roundType: values.roundType,
    startsAt: date.toISOString(),
    durationMinutes: Number(values.durationMinutes),
    interviewerName: values.interviewerName?.trim() ?? '',
  };
}

export function localDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  // Shift UTC time forward by IST offset and read via getUTC* methods
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, '0');

  return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())}T${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}`;
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