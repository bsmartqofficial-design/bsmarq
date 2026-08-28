const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

async function askGemini(message, context) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to your .env file.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `You are BsmartQ AI, an operations assistant for ${context.organization.name}. Help staff with queue management, service tasks, customer flow, staffing, counters, appointments, reports, and clear workplace communication. Give practical, concise steps. Use only the organization context supplied below for current operational facts. Never invent ticket data, expose passwords or API keys, or claim to have completed an action you cannot perform. If asked to perform an action, explain the steps or identify the relevant BsmartQ control.

Organization context:
${JSON.stringify(context)}` }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700 }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini could not answer right now.');
  const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!answer) throw new Error('Gemini returned an empty response.');
  return answer;
}

module.exports = { askGemini };
