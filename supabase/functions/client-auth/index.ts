import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, username, password, device_id, user_id } = await req.json();

    if (action === 'login') {
      const { data: client, error } = await supabase
        .from('clients')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

      if (error || !client) {
        return new Response(JSON.stringify({ error: 'Credenciales inválidas' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!client.is_active) {
        return new Response(JSON.stringify({ error: 'Cuenta suspendida. Contacta a tu proveedor.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (new Date(client.expiry_date) < new Date()) {
        await supabase.from('clients').update({ is_active: false }).eq('id', client.id);
        return new Response(JSON.stringify({ error: 'Suscripción expirada. Renueva tu plan.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check concurrent connections
      if (device_id) {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: connections } = await supabase
          .from('active_connections')
          .select('id, device_id')
          .eq('client_id', client.id)
          .gte('last_heartbeat', fiveMinAgo);

        const activeCount = connections?.filter(c => c.device_id !== device_id).length || 0;
        if (activeCount >= client.max_screens) {
          return new Response(JSON.stringify({ 
            error: `Límite de ${client.max_screens} pantalla(s) alcanzado. Cierra otra sesión.` 
          }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Upsert connection
        const { data: existing } = await supabase
          .from('active_connections')
          .select('id')
          .eq('client_id', client.id)
          .eq('device_id', device_id)
          .single();

        if (existing) {
          await supabase.from('active_connections')
            .update({ last_heartbeat: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await supabase.from('active_connections')
            .insert({ client_id: client.id, device_id, last_heartbeat: new Date().toISOString() });
        }
      }

      const [channelsRes, adsRes] = await Promise.all([
        supabase.from('channels').select('id, name, url, category, logo_url, sort_order').eq('is_active', true).order('sort_order'),
        supabase.from('ads').select('id, title, message, image_url').eq('is_active', true)
      ]);

      return new Response(JSON.stringify({
        client: { id: client.id, username: client.username, max_screens: client.max_screens, expiry_date: client.expiry_date },
        channels: channelsRes.data || [],
        ads: adsRes.data || []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'make_first_admin') {
      // Only works if no admins exist yet
      const { data: existingAdmins } = await supabase.from('user_roles').select('id').limit(1);
      if (existingAdmins && existingAdmins.length > 0) {
        return new Response(JSON.stringify({ error: 'Ya existe un administrador' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'user_id requerido' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      await supabase.from('user_roles').insert({ user_id, role: 'admin' });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Acción no válida' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error del servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
