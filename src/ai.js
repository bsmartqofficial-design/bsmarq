const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function normaliseStatus(status = '') {
  return String(status).trim().toLowerCase();
}

function parseWaitMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numeric)) return numeric;
  return null;
}

function buildQueueFallbackAnswer(message, context = {}) {
  const text = String(message || '').toLowerCase();
  const tickets = Array.isArray(context.activeTickets) ? context.activeTickets : [];
  const stats = context.stats || {};
  const waitingFromTickets = tickets.filter((ticket) => ['waiting', 'queued', 'pending'].includes(normaliseStatus(ticket.status))).length;
  const servingFromTickets = tickets.filter((ticket) => ['called', 'now serving', 'now_serving', 'serving'].includes(normaliseStatus(ticket.status))).length;
  const waitingCount = Number(stats.waiting ?? waitingFromTickets ?? 0);
  const servingCount = Number(stats.serving ?? servingFromTickets ?? 0);
  const completedCount = Number(stats.completed || 0);
  const avgWait = parseWaitMinutes(stats.avgWait) ?? 10;
  const nextTicket = tickets.find((ticket) => ['waiting', 'queued', 'pending', 'called'].includes(normaliseStatus(ticket.status))) || tickets[0] || null;

  if (/how many.*(people|customers).*queue|how many.*waiting|waiting.*count|queue.*count|line.*count|how many.*in line|how many.*in queue|there.*people.*waiting/.test(text)) {
    return `${waitingCount} people are currently waiting in the queue.`;
  }

  if (/is there.*queue|is there.*line|any.*waiting|queue.*status|line.*status/.test(text)) {
    if (waitingCount === 0 && servingCount === 0) return 'There is no active queue right now.';
    return `${waitingCount} people are waiting and ${servingCount} are being served.`;
  }

  if (/how many.*(being served|serving|active).*/.test(text)) {
    return `${servingCount} customers are currently being served.`;
  }

  if (/average.*wait|avg.*wait|wait time|how long.*wait|what.*wait|line.*wait/.test(text)) {
    const waitLabel = avgWait ? `${Math.round(avgWait)} min` : '10 min';
    return `${waitLabel} is the current average wait time.`;
  }

  if (/next customer|next ticket|who is next|who.*next|which.*next/.test(text)) {
    if (!nextTicket) return 'There is no active ticket in the queue.';
    return `The next ticket is ${nextTicket.number}.`;
  }

  if (/call next customer|call.*next|next customer now/.test(text)) {
    return 'CALL_NEXT_CUSTOMER';
  }

  if (/complete ticket|finish ticket|complete.*customer|mark.*done/.test(text)) {
    return 'COMPLETE_TICKET';
  }

  if (/skip ticket|skip.*customer|move on/.test(text)) {
    return 'SKIP_TICKET';
  }

  if (/total.*customers|queue.*size|how big.*queue|how many.*total/.test(text)) {
    return `${waitingCount + servingCount} customers are active across the queue right now.`;
  }

  if (/completed.*today|how many.*completed|done today/.test(text)) {
    return `${completedCount} customers were completed today.`;
  }

  if (!tickets.length && !stats.waiting && !stats.serving) {
    return `0 people are waiting in the queue. No live queue data is available.`;
  }

  return `${waitingCount} people are waiting, ${servingCount} are being served, and the average wait is ${Math.round(avgWait)} min.`;
}

async function askGemini(message, context) {
  if (!process.env.GEMINI_API_KEY) {
    return buildQueueFallbackAnswer(message, context);
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `You are the SmartQ Queue Assistant for ${context.organization.name}. Help internal staff manage customer flow with quick, operational answers.

Rules:
1. Keep every answer under two sentences.
2. Always start with the exact number or time requested.
3. No fluff. Do not say hello, thank you, or offer generic help.
4. If wait time exceeds 15 minutes, add the exact warning: "⚠️ HIGH WAIT TIME".
5. When staff mention waiting time, use only these values: 5 min, 10 min, 15 min, 20 min.
6. If the user asks for an action like calling the next customer, skip explanation and trigger the matching system command: CALL_NEXT_CUSTOMER, COMPLETE_TICKET, SKIP_TICKET, SET_WAIT_TIME_5, SET_WAIT_TIME_10, SET_WAIT_TIME_15, SET_WAIT_TIME_20.
7. Use only the live queue data provided below; do not invent tickets, counters, or wait times.
8. If no queue data is provided, state the current waiting count and that no live queue data is available.

Organization context:
${JSON.stringify(context)}` }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 700 }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini could not answer right now.');
    }

    const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!answer) {
      throw new Error('Gemini returned an empty response.');
    }
    return answer;
  } catch (error) {
    return buildQueueFallbackAnswer(message, context);
  }
}

module.exports = { askGemini, buildQueueFallbackAnswer };
