const choices = values => ({ type: 'string', enum: values });
const text = { type: 'string' };
const tone = choices(['given', 'note', 'answer']);
const boardFormat = {
  type: 'object', additionalProperties: false,
  required: ['action', 'problem', 'title', 'topic', 'layout', 'columns', 'rows', 'diagram', 'caption', 'question', 'complete'],
  properties: {
    action: choices(['new', 'update', 'keep']), problem: text, title: text,
    topic: choices(['addition', 'subtraction', 'multiplication', 'division', 'fractions', 'algebra', 'geometry', 'general']),
    layout: choices(['columns', 'division', 'equations', 'diagram']), columns: { type: 'integer' },
    rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'heading', 'explanation', 'result', 'rule', 'cells'], properties: {
      id: text, heading: text, explanation: text, result: { type: 'boolean' }, rule: { type: 'boolean' },
      cells: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'tone', 'previous'], properties: { text, tone, previous: text } } }
    } } },
    diagram: { type: 'object', additionalProperties: false, required: ['shape', 'labels', 'gridColumns', 'gridRows', 'showGrid'], properties: {
      shape: choices(['none', 'triangle', 'rectangle']), labels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['position', 'text', 'tone'], properties: { position: choices(['top', 'left', 'right', 'bottom', 'center']), text, tone } } },
      gridColumns: { type: 'integer' }, gridRows: { type: 'integer' }, showGrid: { type: 'boolean' }
    } },
    caption: text, question: text, complete: { type: 'boolean' }
  }
};

const RESPONSE_FORMAT = { type: 'json_schema', name: 'classroom_teaching_step', strict: true, schema: {
  type: 'object', additionalProperties: false, required: ['show', 'say', 'board'],
  properties: { show: text, say: text, board: boardFormat }
} };

function outputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  return (payload.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('').trim();
}

const valid = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

function cleanBoard(raw, previous, lesson) {
  if (!raw || !['new', 'update', 'keep'].includes(raw.action) || !valid(raw.problem, 180) || !valid(raw.title, 120)) return null;
  if (!['addition', 'subtraction', 'multiplication', 'division', 'fractions', 'algebra', 'geometry', 'general'].includes(raw.topic)) return null;
  if (!['columns', 'division', 'equations', 'diagram'].includes(raw.layout) || !Number.isInteger(raw.columns) || raw.columns < 1 || raw.columns > 10) return null;
  if (!Array.isArray(raw.rows) || raw.rows.length > 24 || !raw.rows.length) return null;
  const ids = new Set();
  const rows = raw.rows.map(row => {
    if (!row || !valid(row.id, 40) || !row.id || ids.has(row.id) || !valid(row.heading, 100) || !valid(row.explanation, 160) || typeof row.result !== 'boolean' || typeof row.rule !== 'boolean' || !Array.isArray(row.cells) || !row.cells.length || row.cells.length > raw.columns) return null;
    ids.add(row.id);
    const cells = row.cells.map(cell => cell && valid(cell.text, 160) && valid(cell.previous, 60) && ['given', 'note', 'answer'].includes(cell.tone) ? cell : null);
    return cells.every(Boolean) ? { ...row, cells } : null;
  });
  const diagram = raw.diagram;
  if (rows.some(row => !row) || !diagram || !['none', 'triangle', 'rectangle'].includes(diagram.shape) || !Array.isArray(diagram.labels) || diagram.labels.length > 5 || !Number.isInteger(diagram.gridColumns) || !Number.isInteger(diagram.gridRows) || diagram.gridColumns < 0 || diagram.gridColumns > 12 || diagram.gridRows < 0 || diagram.gridRows > 12 || typeof diagram.showGrid !== 'boolean') return null;
  const positions = new Set();
  const labels = diagram.labels.map(label => {
    if (!label || !['top', 'left', 'right', 'bottom', 'center'].includes(label.position) || positions.has(label.position) || !valid(label.text, 60) || !['given', 'note', 'answer'].includes(label.tone)) return null;
    positions.add(label.position); return label;
  });
  if (labels.some(label => !label) || !valid(raw.caption, 350) || !valid(raw.question, 500) || typeof raw.complete !== 'boolean') return null;
  return { ...raw, action: previous?.rows?.length ? 'update' : 'new', rows, diagram: { ...diagram, labels, scene: null } };
}

export async function createTeachingStep(env, room, instruction) {
  if (!env.OPENAI_API_KEY) return { error: 'AI is not configured yet.', status: 503 };
  const lesson = room.lesson || {};
  if (!lesson.topic) return { error: 'Start a lesson first.', status: 400 };
  if (lesson.paused) return { error: 'Resume the lesson first.', status: 409 };
  const prior = room.board?.diagram ? JSON.stringify(room.board).slice(0, 18000) : '(no board step yet)';
  const prompt = `You are Numbafox, a warm maths teacher leading a live class in Nigeria. Create exactly ONE next teaching step.\n` +
    `Topic: ${lesson.topic}\nQuestion: ${lesson.question || 'Choose a suitable example.'}\nTeacher briefing: ${lesson.teacherGuidance || 'None'}\nTeacher instruction: ${instruction || 'Continue the lesson.'}\n` +
    `This is step ${Number(lesson.step || 0) + 1}. Do not reveal later steps or the final answer unless explicitly asked.\n` +
    `show is ONLY what students see with their eyes: a concise labelled step, visual explanation, and one question. say is ONLY what students hear: natural speech using words instead of symbolic notation. They must teach the same single step.\n` +
    `board is the exact visual board for show. Preserve stable row IDs from this prior board when updating: ${prior}. For trigonometry, use diagram.shape triangle and label known sides or angles. Never use HTML, Markdown, or LaTex.`;
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', instructions: 'Teach school mathematics safely and follow the response schema exactly.', input: prompt, store: false, max_output_tokens: 3500, text: { format: RESPONSE_FORMAT } }), signal: AbortSignal.timeout(45000)
    });
  } catch { return { error: 'AI is unavailable. Please try again.', status: 502 }; }
  if (response.status === 429) return { error: 'AI is busy. Please try again shortly.', status: 429 };
  if (response.status === 401 || response.status === 403) return { error: 'Check the AI configuration.', status: 503 };
  if (!response.ok) return { error: 'AI is unavailable. Please try again.', status: 502 };
  try {
    const answer = JSON.parse(outputText(await response.json()));
    const show = String(answer.show || '').trim().slice(0, 6000);
    const say = String(answer.say || '').trim().slice(0, 5000);
    const board = cleanBoard(answer.board, room.board, lesson);
    if (!show || !say || !board) throw new Error('invalid AI response');
    return { update: { board, working: show, explanation: say } };
  } catch { return { error: 'AI could not prepare a valid visual step. Please try again.', status: 502 }; }
}
