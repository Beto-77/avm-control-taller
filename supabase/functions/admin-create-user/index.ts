import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const appUrlValue = Deno.env.get('APP_URL');
const allowedOrigins = (Deno.env.get('APP_URLS') || appUrlValue || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => new URL(origin).origin);

const jsonHeaders = { 'Content-Type': 'application/json' };

function response(status: number, body: Record<string, string>, origin?: string) {
  const headers = new Headers(jsonHeaders);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || undefined;

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrlValue) {
    console.error('Missing required Supabase or APP_URL environment configuration.');
    return response(500, { error: 'La función de invitaciones no está configurada.' }, origin);
  }

  if (origin && !allowedOrigins.includes(origin)) {
    return response(403, { error: 'Origen no autorizado.' });
  }

  if (request.method === 'OPTIONS') {
    return response(200, { ok: 'true' }, origin);
  }

  if (request.method !== 'POST') {
    return response(405, { error: 'Método no permitido.' }, origin);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return response(401, { error: 'Debes iniciar sesión como Administrador.' }, origin);
  }

  try {
    const token = authorization.slice('Bearer '.length);
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return response(401, { error: 'La sesión expiró. Vuelve a iniciar sesión.' }, origin);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Unable to verify the caller profile:', profileError.message);
      return response(500, { error: 'No se pudo verificar el perfil Administrador.' }, origin);
    }
    if (callerProfile?.role !== 'admin') {
      return response(403, { error: 'Solo un Administrador puede crear usuarios.' }, origin);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return response(400, { error: 'La solicitud debe contener JSON válido.' }, origin);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return response(400, { error: 'Los datos del usuario no son válidos.' }, origin);
    }

    const body = payload as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const role = body.role;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return response(400, { error: 'Ingresa un correo electrónico válido.' }, origin);
    }
    if (displayName.length < 2 || displayName.length > 80) {
      return response(400, { error: 'El nombre debe tener entre 2 y 80 caracteres.' }, origin);
    }
    if (role !== 'admin' && role !== 'tecnico') {
      return response(400, { error: 'Selecciona un perfil válido.' }, origin);
    }

    const appUrl = new URL(appUrlValue);
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin
      .inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo: appUrl.origin
      });

    if (inviteError) {
      console.error('Unable to invite user:', inviteError.message);
      const message = inviteError.message.toLowerCase().includes('already')
        ? 'Ya existe una cuenta con ese correo.'
        : 'No se pudo enviar la invitación. Verifica la configuración de correo de Supabase.';
      return response(400, { error: message }, origin);
    }
    if (!inviteData.user) {
      console.error('Supabase returned no user after a successful invite.');
      return response(500, { error: 'Supabase no confirmó la creación de la cuenta.' }, origin);
    }

    const { data: updatedProfile, error: updateError } = await adminClient
      .from('profiles')
      .update({ display_name: displayName, role })
      .eq('id', inviteData.user.id)
      .select('id')
      .maybeSingle();

    if (updateError || !updatedProfile) {
      if (updateError) console.error('Unable to apply invited user profile:', updateError.message);
      else console.error('The invited user profile was not created by the auth trigger.');
      return response(500, {
        error: 'La invitación se envió, pero no se pudo aplicar el perfil. Revisa la cuenta en Equipo.'
      }, origin);
    }

    return response(200, { message: 'Usuario creado e invitación enviada.' }, origin);
  } catch (error) {
    console.error('Unexpected error creating an invited user:', error);
    return response(500, { error: 'No se pudo completar la invitación.' }, origin);
  }
});
