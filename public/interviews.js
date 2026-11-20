import { interviewPayload, interviewPresentation, localDateTime } from './interview-view.js';

export function setupInterviews({ api, getToken }) {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('interview-dialog');
  const form = byId('round-form');
  let selectedApplication = null;
  let editingRoundId = null;
  let generation = 0;
  let agendaGeneration = 0;
  const timezone = 'Asia/Kolkata';
  const dateFormatter = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: timezone,
  });
  for (const label of document.querySelectorAll('.timezone-label')) {
    label.textContent = `Times shown in IST (Asia/Kolkata).`;
  }
  const roundPath = (applicationId, roundId = '') =>
    `/api/applications/${encodeURIComponent(applicationId)}/interviews${roundId ? `/${encodeURIComponent(roundId)}` : ''}`;
  const fail = (id, error) => { byId(id).textContent = error.message; };

  function resetForm() {
    editingRoundId = null;
    form.reset();
    byId('round-form-title').textContent = 'Schedule an interview round';
    byId('round-submit').textContent = 'Schedule round';
    byId('cancel-round-edit').classList.add('hidden');
    byId('round-form-message').textContent = '';
  }

  async function downloadCalendar(applicationId, roundId, button) {
    button.disabled = true;
    try {
      const response = await fetch(`${roundPath(applicationId, roundId)}/calendar.ics`, {
        headers: { authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message || 'Calendar download failed');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `interview-${roundId}.ics`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      button.disabled = false;
    }
  }

  async function loadAgenda() {
    const current = ++agendaGeneration;
    const days = byId('agenda-range').value;
    byId('agenda-message').textContent = '';
    const body = await api(`/api/interviews/agenda?days=${encodeURIComponent(days)}`);
    if (current !== agendaGeneration) return;
    const list = byId('agenda-list');
    list.replaceChildren();
    if (!body.interviewRounds.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = days === '7' ? 'No interviews scheduled in the next 7 days.' : 'No upcoming interviews.';
      list.append(empty);
    }
    for (const round of body.interviewRounds) {
      const card = document.createElement('article');
      card.className = `agenda-item${round.withinNext7Days ? ' agenda-soon' : ''}`;
      const time = document.createElement('time');
      time.dateTime = round.startsAt;
      time.textContent = dateFormatter.format(new Date(round.startsAt));
      const title = document.createElement('strong');
      title.textContent = `${round.roundType} · ${round.company}`;
      const subtitle = document.createElement('p');
      subtitle.className = 'field-hint';
      subtitle.textContent = `${round.role} · ${round.interviewerName} · ${round.durationMinutes} min`;
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'button button-small button-quiet';
      view.textContent = 'View rounds';
      view.addEventListener('click', () => open(round.applicationId));
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'button button-small button-quiet';
      download.textContent = 'Download .ics';
      download.addEventListener('click', () => downloadCalendar(round.applicationId, round.id, download)
        .catch((error) => fail('agenda-message', error)));
      actions.append(view, download);
      card.append(time, title, subtitle);
      if (round.withinNext7Days) {
        const badge = document.createElement('span');
        badge.className = 'soon-badge';
        badge.textContent = 'Within 7 days';
        card.append(badge);
      }
      card.append(actions);
      list.append(card);
    }
  }

  function renderRounds(rounds, application) {
    const list = byId('round-list');
    list.replaceChildren();
    const closed = ['OFFER', 'REJECTED'].includes(application.status);
    form.classList.toggle('hidden', closed);
    byId('closed-application-note').classList.toggle('hidden', !closed);
    if (!rounds.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No interview rounds yet.';
      list.append(empty);
    }
    for (const round of rounds) {
      const card = byId('interview-round-template').content.firstElementChild.cloneNode(true);
      const view = interviewPresentation(round);
      const message = card.querySelector('.round-message');
      card.querySelector('.round-type').textContent = round.roundType;
      card.querySelector('.round-status').textContent = view.label;
      card.querySelector('.round-status').dataset.status = round.status;
      card.querySelector('.round-start').textContent = `${dateFormatter.format(view.startsAt)} – ${dateFormatter.format(view.endsAt)}`;
      card.querySelector('.round-interviewer').textContent = `Interviewer: ${round.interviewerName} · ${round.durationMinutes} minutes`;
      for (const [selector, label, value] of [
        ['.round-notes', 'Debrief', round.feedbackNotes],
        ['.round-salary', 'Salary insights', round.salaryInsights],
      ]) {
        const text = card.querySelector(selector);
        text.textContent = `${label}: ${value}`;
        text.classList.toggle('hidden', !value);
      }
      const download = card.querySelector('.download-calendar');
      download.addEventListener('click', () => downloadCalendar(application.id, round.id, download)
        .catch((error) => { message.textContent = error.message; }));
      const edit = card.querySelector('.reschedule-round');
      edit.classList.toggle('hidden', closed || !view.canReschedule);
      edit.addEventListener('click', () => {
        editingRoundId = round.id;
        const [date, time] = localDateTime(round.startsAt).split('T');
        for (const [key, value] of Object.entries({ ...round, date, time })) {
          const control = form.elements.namedItem(key);
          if (control) control.value = value;
        }
        byId('round-form-title').textContent = 'Edit interview schedule';
        byId('round-submit').textContent = 'Save schedule';
        byId('cancel-round-edit').classList.remove('hidden');
        byId('round-form-message').textContent = '';
        form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        form.elements.namedItem('roundType').focus();
      });
      const remove = card.querySelector('.delete-round');
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this interview round?')) return;
        remove.disabled = true;
        try {
          await api(roundPath(application.id, round.id), { method: 'DELETE' });
          if (editingRoundId === round.id) resetForm();
          await refresh();
        } catch (error) {
          message.textContent = error.message;
        } finally {
          remove.disabled = false;
        }
      });
      card.querySelector('.round-feedback').classList.toggle('hidden', !view.canRecordFeedback);
      card.querySelector('.feedback-locked').classList.toggle('hidden', view.canRecordFeedback);
      const feedback = card.querySelector('.feedback-form');
      feedback.elements.namedItem('status').value = round.status === 'PASSED' ? 'PASSED' : 'COMPLETED';
      feedback.elements.namedItem('feedbackNotes').value = round.feedbackNotes;
      feedback.elements.namedItem('salaryInsights').value = round.salaryInsights;
      feedback.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = feedback.querySelector('button');
        button.disabled = true;
        try {
          const patch = Object.fromEntries(new FormData(feedback));
          await api(roundPath(application.id, round.id), { method: 'PATCH', body: JSON.stringify(patch) });
          await refresh();
        } catch (error) {
          message.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      list.append(card);
    }
  }

  async function loadRounds() {
    if (!selectedApplication || !dialog.open) return;
    const applicationId = selectedApplication;
    const current = ++generation;
    const { application, interviewRounds } = await api(roundPath(applicationId));
    if (current !== generation || !dialog.open) return;
    byId('interview-company').textContent = application.company;
    byId('interview-role').textContent = application.role;
    renderRounds(interviewRounds, application);
  }

  async function open(applicationId) {
    selectedApplication = applicationId;
    resetForm();
    byId('interview-company').textContent = '';
    byId('interview-role').textContent = '';
    byId('interview-message').textContent = '';
    byId('round-list').textContent = 'Loading interview rounds…';
    form.classList.add('hidden');
    byId('closed-application-note').classList.add('hidden');
    if (!dialog.open) dialog.showModal();
    try {
      await loadRounds();
    } catch (error) {
      byId('round-list').replaceChildren();
      fail('interview-message', error);
    }
  }

  async function refresh() {
    await Promise.all([loadAgenda(), loadRounds()]);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const applicationId = selectedApplication;
    const roundId = editingRoundId;
    const button = byId('round-submit');
    button.disabled = true;
    byId('round-form-message').textContent = '';
    try {
      const payload = interviewPayload(Object.fromEntries(new FormData(form)));
      await api(roundPath(applicationId, roundId), {
        method: roundId ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      if (selectedApplication === applicationId && dialog.open) {
        resetForm();
        byId('interview-message').textContent = roundId ? 'Interview schedule updated.' : 'Interview round scheduled.';
      }
      await refresh();
    } catch (error) {
      fail('round-form-message', error);
    } finally {
      button.disabled = false;
    }
  });
  byId('cancel-round-edit').addEventListener('click', resetForm);
  byId('close-interviews').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { selectedApplication = null; generation++; resetForm(); });
  byId('agenda-range').addEventListener('change', () => loadAgenda().catch((error) => fail('agenda-message', error)));
  byId('refresh-agenda').addEventListener('click', () => refresh().catch((error) => fail('agenda-message', error)));
  byId('refresh-rounds').addEventListener('click', () => loadRounds().catch((error) => fail('interview-message', error)));

  return {
    open,
    refresh,
    loadAgenda,
    reset() {
      selectedApplication = null;
      generation++;
      agendaGeneration++;
      if (dialog.open) dialog.close();
      byId('agenda-list').replaceChildren();
      byId('agenda-message').textContent = '';
    },
  };
}