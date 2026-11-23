const RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'teacher_lesson_step',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['say', 'show'],
    properties: { say: { type: 'string' }, show: { type: 'string' } }
  }
};

function outputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  return (payload.output || []).filter(item => item.type === 'message')
    .flatMap(item => item.content || []).filter(item => item.type === 'output_text')
    .map(item => item.text).join('').trim();
}

function boardFrom(show, lesson) {
  const lines = show.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
  const rows = (lines.length ? lines : ['The AI is preparing the first step.']).map((text, index) => ({
    id: `step-${index + 1}`, rule: false, result: index === lines.length - 1,
    cells: [{ text: text.slice(0, 160), tone: index === lines.length - 1 ? 'answer' : 'given', previous: '' }]
  }));
  return {
    action: lesson.step ? 'update' : 'new', problem: lesson.question || lesson.topic,
    title: lesson.topic || 'Live lesson', topic: 'algebra', layout: 'equations', columns: 1,
    rows, diagram: { shape: 'none', scene: null, labels: [], gridColumns: 0, gridRows: 0, showGrid: false },
    caption: '', question: '', complete: false
  };
}

export async function createTeachingStep(env, room, instruction) {
  if (!env.OPENAI_API_KEY) return { error: 'AI is not configured yet.', status: 503 };
  const lesson = room.lesson || {};
  if (!lesson.topic) return { error: 'Start a lesson first.', status: 400 };
  if (lesson.paused) return { error: 'Resume the lesson first.', status: 409 };
  const prompt = `You are Numbafox, a warm maths teacher leading a live class in Nigeria. Teach one clear, manageable next step.\n` +
    `Topic: ${lesson.topic}\nQuestion: ${lesson.question || 'Choose a suitable example.'}\n` +
    `Teacher briefing: ${lesson.teacherGuidance || 'None'}\nTeacher instruction: ${instruction || 'Continue the lesson.'}\n` +
    `Return JSON only. show is concise board text with one line per step. say is a natural spoken explanation, 20 to 120 words. Do not use Markdown.`;
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', instructions: 'Follow the teacher’s requested lesson direction and teach safely.', input: prompt, store: false, max_output_tokens: 1800, text: { format: RESPONSE_FORMAT } }),
      signal: AbortSignal.timeout(45000)
    });
  } catch { return { error: 'AI is unavailable. Please try again.', status: 502 }; }
  if (response.status === 429) return { error: 'AI is busy. Please try again shortly.', status: 429 };
  if (response.status === 401 || response.status === 403) return { error: 'Check the AI configuration.', status: 503 };
  if (!response.ok) return { error: 'AI is unavailable. Please try again.', status: 502 };
  try {
    const answer = JSON.parse(outputText(await response.json()));
    const show = String(answer.show || '').trim().slice(0, 5000);
    const say = String(answer.say || '').trim().slice(0, 5000);
    if (!show || !say) throw new Error('empty AI response');
    return { update: { board: boardFrom(show, lesson), working: show, explanation: say } };
  } catch { return { error: 'AI could not prepare a valid board. Please try again.', status: 502 }; }
}
