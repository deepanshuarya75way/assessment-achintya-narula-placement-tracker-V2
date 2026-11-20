import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { normalizeStoredApplication, type ApplicationStatus, type JobApplication } from '../domain/application.ts';
import {
  updateInterviewRound as applyInterviewUpdate,
  InterviewValidationError,
  type InterviewPatch,
  type InterviewRound,
} from '../domain/interview.ts';
import { buildInterviewAgenda, type InterviewAgendaItem } from '../domain/agenda.ts';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface ReminderRecord {
  id: string;
  userId: string;
  applicationId: string;
  followUpDate: string;
  message: string;
  createdAt: string;
}

interface Database {
  users: UserRecord[];
  applications: JobApplication[];
  reminders: ReminderRecord[];
  interviewRounds: InterviewRound[];
}

const emptyDatabase = (): Database => ({
  users: [],
  applications: [],
  reminders: [],
  interviewRounds: [],
});

export class JsonStore {
  readonly #file: string;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    try {
      await this.#read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.#write(emptyDatabase());
    }
  }

  async #read(): Promise<Database> {
    const parsed = JSON.parse(await readFile(this.#file, 'utf8')) as Partial<Database>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      applications: Array.isArray(parsed.applications)
        ? parsed.applications.map((application) => normalizeStoredApplication(application))
        : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      interviewRounds: Array.isArray(parsed.interviewRounds)
        ? parsed.interviewRounds
        : [],
    };
  }

  async #write(database: Database): Promise<void> {
    const temporary = `${this.#file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }

  #mutate<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const database = await this.#read();
      const result = await operation(database);
      await this.#write(database);
      return result;
    };
    const queued = this.#writeQueue.then(run, run);
    this.#writeQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async createUser(input: UserRecord): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('Email is invalid');
    return this.#mutate((database) => {
      if (database.users.some((user) => user.email === email)) {
        throw new Error('Email is already registered');
      }
      const user = { ...input, email };
      database.users.push(user);
      return user;
    });
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const database = await this.#read();
    const normalized = email.trim().toLowerCase();
    return database.users.find((user) => user.email === normalized);
  }

  async addApplication(application: JobApplication): Promise<JobApplication> {
    return this.#mutate((database) => {
      if (database.applications.some((item) => item.id === application.id)) {
        throw new Error('Application already exists');
      }
      database.applications.push(application);
      return application;
    });
  }

  async listApplications(
    userId: string,
    filters: { query?: string; status?: ApplicationStatus } = {},
  ): Promise<JobApplication[]> {
    const database = await this.#read();
    const query = filters.query?.trim().toLowerCase() ?? '';
    return database.applications.filter((item) => {
      if (item.userId !== userId) return false;
      if (filters.status && item.status !== filters.status) return false;
      return query === '' || item.company.toLowerCase().includes(query) || item.role.toLowerCase().includes(query);
    });
  }

  async getApplication(userId: string, id: string): Promise<JobApplication | undefined> {
    const database = await this.#read();
    return database.applications.find((item) => item.id === id && item.userId === userId);
  }

  async replaceApplication(userId: string, application: JobApplication): Promise<JobApplication | undefined> {
    return this.#mutate((database) => {
      const index = database.applications.findIndex((item) => item.id === application.id && item.userId === userId);
      if (index === -1) return undefined;
      const previous = database.applications[index];
      database.applications[index] = application;
      if (previous.followUpDate !== application.followUpDate || ['OFFER', 'REJECTED'].includes(application.status)) {
        database.reminders = database.reminders.filter((reminder) =>
          reminder.applicationId !== application.id || reminder.userId !== userId);
      }
      return application;
    });
  }

  async deleteApplication(userId: string, id: string): Promise<boolean> {
    return this.#mutate((database) => {
      const index = database.applications.findIndex((item) => item.id === id && item.userId === userId);
      if (index === -1) return false;
      database.applications.splice(index, 1);
      database.reminders = database.reminders.filter((reminder) => reminder.applicationId !== id);
      database.interviewRounds = database.interviewRounds.filter(
        (round) =>
          round.applicationId !== id ||
          round.userId !== userId,
      );
      return true;
    });
  }

  async addInterviewRound(
    userId: string,
    round: InterviewRound,
  ): Promise<InterviewRound | undefined> {
    return this.#mutate((database) => {
      const application = database.applications.find(
        (item) =>
          item.id === round.applicationId &&
          item.userId === userId,
      );

      if (!application || round.userId !== userId) {
        return undefined;
      }

      if (['OFFER', 'REJECTED'].includes(application.status)) {
        throw new InterviewValidationError('Cannot schedule interviews for a closed application');
      }

      if (database.interviewRounds.some((item) => item.id === round.id)) {
        throw new InterviewValidationError('Interview round already exists');
      }

      database.interviewRounds.push(round);
      return round;
    });
  }

  async listInterviewRounds(
    userId: string,
    applicationId: string,
  ): Promise<InterviewRound[]> {
    const database = await this.#read();

    return database.interviewRounds
      .filter(
        (round) =>
          round.userId === userId &&
          round.applicationId === applicationId,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async updateInterviewRound(
    userId: string,
    applicationId: string,
    roundId: string,
    patch: InterviewPatch,
    now = new Date(),
  ): Promise<InterviewRound | undefined> {
    return this.#mutate((database) => {
      const application = database.applications.find(
        (item) =>
          item.id === applicationId &&
          item.userId === userId,
      );

      if (!application) return undefined;

      const rescheduling = ['roundType', 'startsAt', 'durationMinutes', 'interviewerName']
        .some((key) => Object.hasOwn(patch, key));
      if (rescheduling && ['OFFER', 'REJECTED'].includes(application.status)) {
        throw new InterviewValidationError('Cannot reschedule interviews for a closed application');
      }

      const index = database.interviewRounds.findIndex(
        (round) =>
          round.id === roundId &&
          round.applicationId === applicationId &&
          round.userId === userId,
      );

      if (index === -1) return undefined;

      const updated = applyInterviewUpdate(
        database.interviewRounds[index],
        patch,
        now,
      );

      database.interviewRounds[index] = updated;
      return updated;
    });
  }

  async listInterviewAgenda(userId: string, now = new Date(), days: number | null = 7): Promise<InterviewAgendaItem[]> {
    const database = await this.#read();
    return buildInterviewAgenda(database.applications, database.interviewRounds, userId, now, days);
  }

  async deleteInterviewRound(userId: string, applicationId: string, roundId: string): Promise<boolean> {
    return this.#mutate((database) => {
      if (!database.applications.some((item) => item.id === applicationId && item.userId === userId)) return false;
      const index = database.interviewRounds.findIndex((round) =>
        round.id === roundId && round.applicationId === applicationId && round.userId === userId);
      if (index === -1) return false;
      database.interviewRounds.splice(index, 1);
      return true;
    });
  }

  async listReminders(userId: string): Promise<ReminderRecord[]> {
    const database = await this.#read();
    return database.reminders.filter((reminder) => reminder.userId === userId);
  }

  async addReminders(reminders: ReminderRecord[]): Promise<ReminderRecord[]> {
    return this.#mutate((database) => {
      const existingIds = new Set(database.reminders.map((reminder) => reminder.id));
      const added = reminders.filter((reminder) => {
        if (existingIds.has(reminder.id)) return false;
        const application = database.applications.find((item) =>
          item.id === reminder.applicationId && item.userId === reminder.userId);
        return application?.followUpDate === reminder.followUpDate &&
          application.status !== 'OFFER' && application.status !== 'REJECTED';
      });
      database.reminders.push(...added);
      return added;
    });
  }
}