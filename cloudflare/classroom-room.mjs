import { DurableObject } from 'cloudflare:workers';

const emptyRoom = () => ({
  title: 'Welcome to Numbafox classroom', status: 'waiting',
  board: { title: 'The Board', layout: 'working', rows: [], angles: [] },
  explanation: 'Your lesson will appear here.', working: 'Your written explanation will appear here.',
  messages: [], questions: [], hands: [], poll: null, recap: [], members: [],
  reveal: { visible: 0, total: 0 },
  lesson: { topic: '', introduction: '', question: '', speaker: 'ai', step: 0, paused: false },
  voice: { active: false, teacherId: null }
});

function checkpoint(room, label) {
  if (!room.board?.rows?.length && !room.working && !room.explanation) return room.recap || [];
  return [...(room.recap || []), {
    id: crypto.randomUUID(), label, at: Date.now(), board: room.board,
    working: room.working || '', explanation: room.explanation || ''
  }].slice(-40);
}

export class ClassroomRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = emptyRoom();
    this.eventStreams = new Map();
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || emptyRoom();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/events')) return this.events(request);
    if (url.pathname.endsWith('/presence') && request.method === 'POST') return this.presence(request);
    if (url.pathname.endsWith('/leave') && request.method === 'POST') return this.leave(request);
    if (url.pathname.endsWith('/membership')) return this.membership(request);
    if (url.pathname.endsWith('/connect')) return this.connect(request);
    if (request.method === 'GET') return Response.json(this.publicRoom());
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const event = await request.json();
    if (!event?.type) return Response.json({ error: 'Invalid room event.' }, { status: 400 });
    await this.apply(event, this.identity(request));
    return Response.json({ ok: true, room: this.publicRoom() });
  }

  events(request) {
    const id = request.headers.get('X-Classroom-Client') || crypto.randomUUID();
    const name = request.headers.get('X-Classroom-Name') || 'Guest';
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const client = { id, name, writer };
    this.eventStreams.set(id, client);
    this.sendEvent(client, 'state', this.publicRoom());
    this.publishPresence();

    const close = () => {
      if (this.eventStreams.get(id) !== client) return;
      this.eventStreams.delete(id);
      writer.close().catch(() => {});
      this.publishPresence();
    };
    request.signal.addEventListener('abort', close, { once: true });
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    });
  }

  async presence(request) {
    const { id, name } = await request.json();
    const client = this.eventStreams.get(String(id || ''));
    if (client) {
      client.name = String(name || 'Guest').trim().slice(0, 30) || 'Guest';
      this.publishPresence();
    }
    return Response.json({ ok: true });
  }

  async leave(request) {
    const { id } = await request.json();
    const client = this.eventStreams.get(String(id || ''));
    if (client) {
      this.eventStreams.delete(client.id);
      client.writer.close().catch(() => {});
      this.publishPresence();
    }
    const userId = request.headers.get('X-Classroom-User');
    if (userId) {
      this.room.members = (this.room.members || []).filter(member => member !== userId);
      await this.ctx.storage.put('room', this.room);
    }
    return Response.json({ ok: true });
  }

  membership(request) {
    const actor = this.identity(request);
    return Response.json({ joined: actor.teacher || (this.room.members || []).includes(actor.userId) });
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
    if (event.type === 'lesson' && event.lesson) {
      if (!actor.teacher) throw new Error('Only teachers can create classes.');
      this.room = { ...emptyRoom(), title: event.lesson.topic, status: 'live', lesson: event.lesson };
    }
    if (event.type === 'join') {
      this.room.members = [...new Set([...(this.room.members || []), actor.userId])];
    }
    if (event.type === 'ai' && event.update) {
      if (!actor.teacher) throw new Error('Only teachers can guide the AI.');
      this.room = {
        ...this.room,
        board: event.update.board,
        working: event.update.working,
        explanation: event.update.explanation,
        lesson: { ...this.room.lesson, step: (this.room.lesson?.step || 0) + 1, speaker: 'ai' }
      };
    }
    if (event.type === 'clear') {
      if (!actor.teacher) throw new Error('Only teachers can clear the board.');
      this.room = {
        ...this.room,
        recap: checkpoint(this.room, 'Board cleared'),
        board: { title: 'The Board', layout: 'working', rows: [], angles: [] },
        working: '', explanation: 'The board has been cleared. Your previous working is saved in Recap.'
      };
    }
    if (event.type === 'end') {
      if (!actor.teacher) throw new Error('Only teachers can end a class.');
      this.room = {
        ...this.room,
        recap: checkpoint(this.room, 'Class ended'),
        status: 'ended',
        lesson: { ...this.room.lesson, paused: true },
        voice: { active: false, teacherId: null }
      };
    }
    if (event.type === 'message' && event.message) this.room.messages = [...this.room.messages, event.message].slice(-100);
    if (event.type === 'question' && event.question) this.room.questions = [...this.room.questions, event.question].slice(-100);
    await this.ctx.storage.put('room', this.room);
    this.broadcast({ type: 'state', room: this.publicRoom() });
    this.publishState();
  }

  publicRoom() {
    const room = structuredClone(this.room);
    delete room.lesson?.teacherGuidance;
    delete room.members;
    return room;
  }

  broadcast(event) {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) socket.send(message);
  }

  sendEvent(client, event, data) {
    client.writer.write(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      if (this.eventStreams.get(client.id) === client) this.eventStreams.delete(client.id);
    });
  }

  publishState() {
    for (const client of this.eventStreams.values()) this.sendEvent(client, 'state', this.publicRoom());
  }

  publishPresence() {
    const people = [...this.eventStreams.values()].map(({ id, name }) => ({ id, name }));
    for (const client of this.eventStreams.values()) this.sendEvent(client, 'presence', people);
  }
}
