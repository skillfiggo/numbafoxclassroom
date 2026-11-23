const RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'teacher_lesson_step',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['heading', 'equation', 'explanation', 'say', 'question', 'complete'],
    properties: {
      heading: { type: 'string' }, equation: { type: 'string' }, explanation: { type: 'string' },
      say: { type: 'string' }, question: { type: 'string' }, complete: { type: 'boolean' }
    }
  }
};

function outputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  return (payload.output || []).filter(item => item.type === 'message')
    .flatMap(item => item.content || []).filter(item => item.type === 'output_text')
    .map(item => item.text).join('').trim();
}

function boardFrom(answer, lesson, previous) {
  const oldRows = Array.isArray(previous?.rows) && previous?.diagram ? previous.rows : [];
  const number = oldRows.length + 1;
  const rows = [...oldRows, {
    id: `step-${number}`, heading: `Step ${number}: ${answer.heading.slice(0, 100)}`,
    explanation: answer.explanation.slice(0, 240), rule: false, result: answer.complete,
    cells: [{ text: answer.equation.slice(0, 160), tone: answer.complete ? 'answer' : 'given', previous: '' }]
  }];
  const trigonometry = /trigon|sine|cosine|tangent|\bsin\b|\bcos\b|\btan\b/i.test(`${lesson.topic} ${lesson.question} ${answer.equation}`);
  const diagram = trigonometry
    ? { shape: 'triangle', scene: null, labels: [
      { position: 'top', text: 'θ', tone: 'given' },
      { position: 'left', text: 'opposite', tone: 'note' },
      { position: 'right', text: 'hypotenuse', tone: 'given' }
    ], gridColumns: 0, gridRows: 0, showGrid: false }
    : { shape: 'none', scene: null, labels: [], gridColumns: 0, gridRows: 0, showGrid: false };
  return {
    action: oldRows.length ? 'update' : 'new', problem: lesson.question || lesson.topic,
    title: lesson.topic || 'Live lesson', topic: 'algebra', layout: 'equations', columns: 1,
    rows, diagram,
    caption: answer.explanation.slice(0, 350), question: answer.question.slice(0, 500), complete: answer.complete
  };
}

export async function createTeachingStep(env, room, instruction) {
  if (!env.OPENAI_API_KEY) return { error: 'AI is not configured yet.', status: 503 };
  const lesson = room.lesson || {};
  if (!lesson.topic) return { error: 'Start a lesson first.', status: 400 };
  if (lesson.paused) return { error: 'Resume the lesson first.', status: 409 };
  const prompt = `You are Numbafox, a warm maths teacher leading a live class in Nigeria. Teach exactly ONE clear, manageable next step.\n` +
    `Topic: ${lesson.topic}\nQuestion: ${lesson.question || 'Choose a suitable example.'}\n` +
    `Teacher briefing: ${lesson.teacherGuidance || 'None'}\nTeacher instruction: ${instruction || 'Continue the lesson.'}\n` +
    `This is step ${Number(lesson.step || 0) + 1}. Do not give later steps or the final answer unless the teacher explicitly asks and it is the final step. ` +
    `Return JSON only: heading labels this step, equation contains only this step's mathematical line, explanation explains why, say is a natural 20–80 word spoken explanation, question asks students to respond before the next step, and complete is false unless the final answer has explicitly been requested.`;
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
    const heading = String(answer.heading || '').trim();
    const equation = String(answer.equation || '').trim();
    const explanation = String(answer.explanation || '').trim();
    const say = String(answer.say || '').trim().slice(0, 5000);
    const question = String(answer.question || '').trim();
    const complete = answer.complete === true;
    if (!heading || !equation || !explanation || !say || !question) throw new Error('empty AI response');
    const step = { heading, equation, explanation, say, question, complete };
    return { update: { board: boardFrom(step, lesson, room.board), working: `${step.heading}\n${step.explanation}\n${step.question}`, explanation: say } };
  } catch { return { error: 'AI could not prepare a valid board. Please try again.', status: 502 }; }
}
