import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // EXPORT: Generate a signed export token with channels
    if (action === 'export') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (!roles || !roles.some((r: any) => r.role === 'admin')) {
        return new Response(JSON.stringify({ error: 'No eres administrador' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get all channels
      const { data: channels, error: chError } = await supabase
        .from('channels')
        .select('name, url, category, logo_url, is_active, keep_alive, sort_order, stream_mode')
        .order('sort_order');

      if (chError) throw chError;

      // Create export package
      const exportData = {
        version: 1,
        system: 'omnisync',
        exported_at: new Date().toISOString(),
        channels_count: channels?.length || 0,
        channels: channels || [],
      };

      // Encode as base64 for easy sharing
      const encoded = btoa(JSON.stringify(exportData));

      return new Response(JSON.stringify({
        export_token: encoded,
        channels_count: channels?.length || 0,
        exported_at: exportData.exported_at,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // IMPORT: Receive channels from another panel
    if (action === 'import') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (!roles || !roles.some((r: any) => r.role === 'admin')) {
        return new Response(JSON.stringify({ error: 'No eres administrador' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const body = await req.json();
      const { export_token, mode } = body; // mode: 'merge' | 'replace'

      if (!export_token) {
        return new Response(JSON.stringify({ error: 'Token de exportación requerido' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let exportData: any;
      try {
        exportData = JSON.parse(atob(export_token));
      } catch {
        return new Response(JSON.stringify({ error: 'Token inválido' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!exportData.system || exportData.system !== 'omnisync') {
        return new Response(JSON.stringify({ error: 'Token no es de un sistema Omnisync' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const channels = exportData.channels || [];
      if (channels.length === 0) {
        return new Response(JSON.stringify({ error: 'No hay canales en el token' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // If replace mode, delete existing channels first
      if (mode === 'replace') {
        await supabase.from('channels').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }

      // Insert channels one by one to handle duplicates
      let imported = 0;
      let skipped = 0;

      for (const ch of channels) {
        // Check if channel with same name and url already exists
        if (mode === 'merge') {
          const { data: existing } = await supabase
            .from('channels')
            .select('id')
            .eq('name', ch.name)
            .eq('url', ch.url)
            .limit(1);

          if (existing && existing.length > 0) {
            skipped++;
            continue;
          }
        }

        const { error } = await supabase.from('channels').insert({
          name: ch.name,
          url: ch.url,
          category: ch.category || 'General',
          logo_url: ch.logo_url || null,
          is_active: ch.is_active !== false,
          keep_alive: ch.keep_alive || false,
          sort_order: ch.sort_order || 0,
          stream_mode: ch.stream_mode || 'direct',
        });

        if (!error) imported++;
        else skipped++;
      }

      return new Response(JSON.stringify({
        imported,
        skipped,
        total: channels.length,
        mode,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // PULL: Connect to a remote panel and pull channels directly
    if (action === 'pull') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (!roles || !roles.some((r: any) => r.role === 'admin')) {
        return new Response(JSON.stringify({ error: 'No eres administrador' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const body = await req.json();
      const { remote_url, remote_admin_token, mode } = body;

      if (!remote_url) {
        return new Response(JSON.stringify({ error: 'URL del panel remoto requerida' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch channels from remote panel's API
      try {
        const remoteResp = await fetch(`${remote_url.replace(/\/$/, '')}/api/channels`, {
          headers: {
            'Authorization': `Bearer ${remote_admin_token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!remoteResp.ok) {
          return new Response(JSON.stringify({ error: `Error conectando al panel remoto: ${remoteResp.status}` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const remoteChannels = await remoteResp.json();
        const channelList = Array.isArray(remoteChannels) ? remoteChannels : (remoteChannels.channels || []);

        if (mode === 'replace') {
          await supabase.from('channels').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        }

        let imported = 0;
        let skipped = 0;

        for (const ch of channelList) {
          if (mode === 'merge') {
            const { data: existing } = await supabase
              .from('channels')
              .select('id')
              .eq('name', ch.name)
              .eq('url', ch.url)
              .limit(1);

            if (existing && existing.length > 0) {
              skipped++;
              continue;
            }
          }

          const { error } = await supabase.from('channels').insert({
            name: ch.name,
            url: ch.url,
            category: ch.category || 'General',
            logo_url: ch.logo_url || null,
            is_active: ch.is_active !== false,
            keep_alive: false,
            sort_order: ch.sort_order || 0,
            stream_mode: ch.stream_mode || 'direct',
          });

          if (!error) imported++;
          else skipped++;
        }

        return new Response(JSON.stringify({
          imported,
          skipped,
          total: channelList.length,
          mode,
          source: remote_url,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (fetchErr: any) {
        return new Response(JSON.stringify({ error: `No se pudo conectar: ${fetchErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Acción no válida. Usa: export, import, pull' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error: ' + (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
