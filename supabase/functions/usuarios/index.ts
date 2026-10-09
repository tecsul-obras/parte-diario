// ══════════════════════════════════════════════════════════════════
// USUARIOS — Edge Function de Supabase (Tecsul S.A.E.)
//
// Lo que la app no puede hacer sola porque necesita la clave de
// administrador de Supabase (service role): dar de alta usuarios,
// cambiarles la contraseña y ver cuándo entraron por última vez.
//
// Esa clave vive SOLO acá (Supabase la pone sola como
// SUPABASE_SERVICE_ROLE_KEY). Antes de hacer nada se verifica, con el
// usuario que llama, que sea admin_central.
//
// Acciones (POST JSON):
//   { accion: 'listar' }  → { usuarios: [{ id, email, ultimo_ingreso, creado }] }
//   { accion: 'crear', usuario: { usuario, nombre, rol, obras, formularios, clave } }
//        usuario = cédula (entra con la cédula) o un correo
//   { accion: 'clave', id, clave } → nueva contraseña (y que la cambie al entrar)
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const DOMINIO_INTERNO = 'tecsul.local';
const ROLES = ['operador', 'admin_obra', 'taller', 'admin_central'];
const FORMULARIOS = ['parte', 'taller', 'combustible'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usar POST' }, 405);

  const URL_SB = Deno.env.get('SUPABASE_URL')!;
  // Con el usuario que llama: solo para saber si es admin_central
  const comoUsuario = createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: esAdmin, error: errAdmin } = await comoUsuario.rpc('es_admin');
  if (errAdmin || !esAdmin) return json({ error: 'Solo un administrador central puede administrar usuarios.' }, 403);

  const admin = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  try {
    const cuerpo = await req.json();

    if (cuerpo.accion === 'listar') {
      const usuarios: { id: string; email: string | undefined; ultimo_ingreso: string | null; creado: string }[] = [];
      for (let pagina = 1; pagina < 50; pagina++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
        if (error) throw error;
        data.users.forEach((u) => usuarios.push({ id: u.id, email: u.email, ultimo_ingreso: u.last_sign_in_at ?? null, creado: u.created_at }));
        if (data.users.length < 1000) break;
      }
      return json({ usuarios });
    }

    if (cuerpo.accion === 'crear') {
      const u = cuerpo.usuario || {};
      const usuario = String(u.usuario || '').trim().toLowerCase();
      const nombre = String(u.nombre || '').trim();
      const rol = String(u.rol || 'operador');
      const clave = String(u.clave || '');
      const obras = Array.isArray(u.obras) ? u.obras.map(String) : [];
      const formularios = Array.isArray(u.formularios) ? u.formularios.filter((f: string) => FORMULARIOS.includes(f)) : null;
      const esCorreo = usuario.includes('@');
      if (!usuario || (!esCorreo && !/^\d{4,10}$/.test(usuario))) return json({ error: 'Poné la cédula (solo números) o un correo.' }, 400);
      if (esCorreo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(usuario)) return json({ error: 'El correo no es válido.' }, 400);
      if (!nombre) return json({ error: 'Falta el nombre.' }, 400);
      if (!ROLES.includes(rol)) return json({ error: 'Rol no válido.' }, 400);
      if (clave.length < 6) return json({ error: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400);
      if (rol === 'admin_obra' && !obras.length) return json({ error: 'Un admin de obra necesita al menos una obra.' }, 400);

      const email = esCorreo ? usuario : `${usuario}@${DOMINIO_INTERNO}`;
      const cedula = esCorreo ? usuario.split('@')[0] : usuario;
      // El perfil lo crea solo el disparador fn_nuevo_usuario con estos datos
      const { data, error } = await admin.auth.admin.createUser({
        email, password: clave, email_confirm: true,
        user_metadata: { cedula, nombre, rol, obras },
      });
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? `Ya existe un usuario ${esCorreo ? 'con ese correo' : 'con esa cédula'}.` : error.message;
        return json({ error: msg }, 400);
      }
      // Con el admin que llama (no con la clave de servicio): la base solo
      // deja cambiar rol / obras / formularios a un admin_central.
      const { error: errPerfil } = await comoUsuario.from('perfiles')
        .update({ formularios, debe_cambiar_clave: true, nombre, rol, obras }).eq('id', data.user.id);
      if (errPerfil) throw errPerfil;
      return json({ ok: true, id: data.user.id, email });
    }

    if (cuerpo.accion === 'clave') {
      const id = String(cuerpo.id || '');
      const clave = String(cuerpo.clave || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Usuario no válido.' }, 400);
      if (clave.length < 6) return json({ error: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password: clave });
      if (error) throw error;
      await comoUsuario.from('perfiles').update({ debe_cambiar_clave: true }).eq('id', id);
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
