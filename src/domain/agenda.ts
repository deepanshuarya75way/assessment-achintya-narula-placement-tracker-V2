import type { JobApplication } from './application.ts';
import type { InterviewRound } from './interview.ts';

export interface InterviewAgendaItem extends InterviewRound {
  company: string;
  role: string;
  withinNext7Days: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;

export function buildInterviewAgenda(
  applications: JobApplication[],
  rounds: InterviewRound[],
  userId: string,
  now = new Date(),
  days: number | null = 7,
): InterviewAgendaItem[] {
  const active = new Map(applications
    .filter((application) => application.userId === userId && !['OFFER', 'REJECTED'].includes(application.status))
    .map((application) => [application.id, application]));
  const start = now.getTime();
  const end = days === null ? Infinity : start + days * dayMs;
  const agenda: InterviewAgendaItem[] = [];
  for (const round of rounds) {
    const application = active.get(round.applicationId);
    const time = Date.parse(round.startsAt);
    if (!application || round.userId !== userId || round.status !== 'SCHEDULED' || time < start || time >= end) continue;
    agenda.push({ ...round, company: application.company, role: application.role,
      withinNext7Days: time < start + 7 * dayMs });
  }
  return agenda.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}