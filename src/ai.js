const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

async function askGemini(message, context) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to your .env file.');
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
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini could not answer right now.');
  const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!answer) throw new Error('Gemini returned an empty response.');
  return answer;
}

module.exports = { askGemini };
