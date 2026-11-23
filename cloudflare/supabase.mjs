export async function supabase(env, path, options = {}) {
  const key = options.privileged ? env.SUPABASE_SECRET_KEY : env.SUPABASE_PUBLISHABLE_KEY;
  if (!env.SUPABASE_URL || !key) throw new Error('Supabase is not configured for this Worker.');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: key,
      // Supabase accepts the project key as a bearer token for privileged REST calls.
      // A user token always wins when we are validating a signed-in user.
      ...(options.privileged && !options.token ? { Authorization: `Bearer ${key}` } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status})`);
    error.status = response.status;
    error.detail = text;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

export function cookie(request, name) {
  const start = `${name}=`;
  const value = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(start))?.slice(start.length);
  return value ? decodeURIComponent(value) : null;
}

export function sessionCookies(request, session) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const value = (name, token, age) => `${name}=${token ? encodeURIComponent(token) : ''}` +
    `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? age : 0}${secure}`;
  return [
    value('classroom_access', session?.access_token, session?.expires_in || 3600),
    value('classroom_refresh', session?.refresh_token, 30 * 86400)
  ];
}

export async function accountFromToken(token, env) {
  const user = await supabase(env, '/auth/v1/user', { token });
  const [role] = await supabase(env, `/rest/v1/classroom_roles?select=role&user_id=eq.${user.id}`, { privileged: true });
  return { user, token, role: role?.role || null, teacher: ['owner', 'teacher'].includes(role?.role), owner: role?.role === 'owner' };
}

export async function authenticatedUser(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return accountFromToken(token, env);
}
