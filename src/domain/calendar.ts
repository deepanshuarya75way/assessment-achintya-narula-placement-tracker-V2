import type { JobApplication } from './application.ts';
import type { InterviewRound } from './interview.ts';

// RFC 5545 TEXT escaping prevents user content from introducing new properties.
function escapeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function calendarDate(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Fold at 75 UTF-8 octets without splitting a multibyte character.
function foldLine(line: string): string {
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character, 'utf8');
    if (bytes + length > 75) {
      parts.push(part);
      part = ' ';
      bytes = 1;
    }
    part += character;
    bytes += length;
  }
  parts.push(part);
  return parts.join('\r\n');
}

export function buildInterviewCalendar(
  round: InterviewRound,
  application: JobApplication,
  now = new Date(),
): string {
  const summary = `${round.roundType} interview — ${application.company}`;
  const description = `Role: ${application.role}\nInterviewer: ${round.interviewerName}\nRound: ${round.roundType}`;
  const end = new Date(Date.parse(round.startsAt) + round.durationMinutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Placement Tracker//Interview Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(round.id)}@placement-tracker.local`,
    `DTSTAMP:${calendarDate(now)}`,
    `CREATED:${calendarDate(round.createdAt)}`,
    `LAST-MODIFIED:${calendarDate(round.updatedAt)}`,
    `DTSTART:${calendarDate(round.startsAt)}`,
    `DTEND:${calendarDate(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'STATUS:CONFIRMED',
    'CLASS:PRIVATE',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    `DESCRIPTION:${escapeText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}