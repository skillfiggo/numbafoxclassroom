import { DurableObject } from 'cloudflare:workers';

const emptyRoom = () => ({
  title: 'Welcome to maths class', status: 'waiting',
  board: { title: 'The Board', layout: 'working', rows: [], angles: [] },
  explanation: 'Your lesson will appear here.', working: 'Your written explanation will appear here.',
  messages: [], questions: [], hands: [], poll: null, recap: [],
  reveal: { visible: 0, total: 0 },
  lesson: { topic: '', introduction: '', question: '', speaker: 'ai', step: 0, paused: false },
  voice: { active: false, teacherId: null }
});

export class ClassroomRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = emptyRoom();
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || emptyRoom();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/connect')) return this.connect(request);
    if (request.method === 'GET') return Response.json(this.publicRoom());
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const event = await request.json();
    if (!event?.type) return Response.json({ error: 'Invalid room event.' }, { status: 400 });
    await this.apply(event, this.identity(request));
    return Response.json({ ok: true, room: this.publicRoom() });
  }

  async connect(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(this.identity(request));
    server.send(JSON.stringify({ type: 'state', room: this.publicRoom() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    try { await this.apply(JSON.parse(String(message)), socket.deserializeAttachment()); }
    catch (error) { socket.send(JSON.stringify({ type: 'error', error: error.message || 'Invalid room event.' })); }
  }

  identity(request) {
    const userId = request.headers.get('X-Classroom-User');
    if (!userId) throw new Error('Classroom identity is required.');
    return { userId, teacher: request.headers.get('X-Classroom-Teacher') === 'true' };
  }

  async apply(event, actor) {
    if (!actor?.userId) throw new Error('Classroom identity is required.');
    if (event.type === 'state' && event.room && typeof event.room === 'object') {
      if (!actor.teacher) throw new Error('Only teachers can update the board.');
      this.room = event.room;
    }
    if (event.type === 'message' && event.message) this.room.messages = [...this.room.messages, event.message].slice(-100);
    if (event.type === 'question' && event.question) this.room.questions = [...this.room.questions, event.question].slice(-100);
    await this.ctx.storage.put('room', this.room);
    this.broadcast({ type: 'state', room: this.publicRoom() });
  }

  publicRoom() {
    const room = structuredClone(this.room);
    delete room.lesson?.teacherGuidance;
    return room;
  }

  broadcast(event) {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) socket.send(message);
  }
}
