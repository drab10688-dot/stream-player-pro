import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Helper: verify admin
async function verifyAdmin(supabase: any, req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) throw { status: 401, message: 'No autorizado' };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw { status: 401, message: 'No autorizado' };
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
  if (!roles || !roles.some((r: any) => r.role === 'admin')) throw { status: 403, message: 'No eres administrador' };
  return user;
}

// HMAC key for signing export tokens
async function getSigningKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw', enc.encode(secret.slice(0, 32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

async function signPayload(payload: any, expiresInHours: number): Promise<string> {
  const key = await getSigningKey();
  const data = {
    ...payload,
    exp: Date.now() + expiresInHours * 3600 * 1000,
  };
  const jsonStr = JSON.stringify(data);
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(jsonStr));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(JSON.stringify({ d: jsonStr, s: sigHex }));
}

async function verifyAndDecodeToken(token: string): Promise<any> {
  const key = await getSigningKey();
  let parsed: any;
  try {
    parsed = JSON.parse(atob(token));
  } catch {
    throw { status: 400, message: 'Token inválido (formato)' };
  }

  if (!parsed.d || !parsed.s) {
    // Legacy token (pre-signature) - try plain base64
    try {
      const legacy = JSON.parse(atob(token));
      if (legacy.system === 'omnisync') return legacy;
    } catch {}
    throw { status: 400, message: 'Token inválido (sin firma)' };
  }

  const enc = new TextEncoder();
  const sigBytes = new Uint8Array(parsed.s.match(/.{2}/g).map((b: string) => parseInt(b, 16)));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(parsed.d));
  if (!valid) throw { status: 400, message: 'Firma del token inválida - no fue generado por este sistema' };

  const data = JSON.parse(parsed.d);
  if (data.exp && Date.now() > data.exp) {
    throw { status: 400, message: 'Token expirado' };
  }
  return data;
}

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

    // ── EXPORT ──
    if (action === 'export') {
      await verifyAdmin(supabase, req);

      // Parse options from body (optional)
      let exportOptions = { expires_hours: 24, normalize_urls: true };
      try {
        const body = await req.json();
        if (body.expires_hours) exportOptions.expires_hours = body.expires_hours;
        if (body.normalize_urls !== undefined) exportOptions.normalize_urls = body.normalize_urls;
      } catch {}

      const { data: channels, error: chError } = await supabase
        .from('channels')
        .select('name, url, category, logo_url, is_active, sort_order, stream_mode, dvr_enabled')
        .order('sort_order');

      if (chError) throw chError;

      // Detect server base URL from request
      const origin = req.headers.get('origin') || req.headers.get('referer') || '';

      const exportChannels = (channels || []).map((ch: any) => ({
        name: ch.name,
        url: ch.url,
        category: ch.category,
        logo_url: ch.logo_url,
        is_active: ch.is_active,
        sort_order: ch.sort_order,
        stream_mode: ch.dvr_enabled ? 'dvr_fmp4' : (ch.stream_mode || 'direct'),
        dvr_enabled: ch.dvr_enabled || false,
      }));

      const exportData = {
        version: 2,
        system: 'omnisync',
        exported_at: new Date().toISOString(),
        channels_count: exportChannels.length,
        format_info: {
          dvr_channels: exportChannels.filter((c: any) => c.dvr_enabled).length,
          stream_types: {
            dvr_fmp4: exportChannels.filter((c: any) => c.stream_mode === 'dvr_fmp4').length,
            direct: exportChannels.filter((c: any) => c.stream_mode === 'direct').length,
            other: exportChannels.filter((c: any) => !['dvr_fmp4', 'direct'].includes(c.stream_mode)).length,
          },
        },
        channels: exportChannels,
      };

      const signedToken = await signPayload(exportData, exportOptions.expires_hours);

      return new Response(JSON.stringify({
        export_token: signedToken,
        channels_count: exportChannels.length,
        dvr_channels: exportData.format_info.dvr_channels,
        exported_at: exportData.exported_at,
        expires_in_hours: exportOptions.expires_hours,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── IMPORT ──
    if (action === 'import') {
      await verifyAdmin(supabase, req);

      const body = await req.json();
      const { export_token, mode } = body;

      if (!export_token) {
        return new Response(JSON.stringify({ error: 'Token de exportación requerido' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let exportData: any;
      try {
        exportData = await verifyAndDecodeToken(export_token);
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || 'Token inválido' }), {
          status: e.status || 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

      if (mode === 'replace') {
        await supabase.from('channels').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }

      let imported = 0;
      let skipped = 0;
      let dvrImported = 0;

      for (const ch of channels) {
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

        const isDvr = ch.dvr_enabled || ch.stream_mode === 'dvr_fmp4';
        const { error } = await supabase.from('channels').insert({
          name: ch.name,
          url: ch.url,
          category: ch.category || 'General',
          logo_url: ch.logo_url || null,
          is_active: ch.is_active !== false,
          keep_alive: false,
          sort_order: ch.sort_order || 0,
          stream_mode: isDvr ? 'direct' : (ch.stream_mode || 'direct'),
          dvr_enabled: isDvr,
        });

        if (!error) {
          imported++;
          if (isDvr) dvrImported++;
        } else skipped++;
      }

      return new Response(JSON.stringify({
        imported,
        skipped,
        total: channels.length,
        dvr_imported: dvrImported,
        mode,
        version: exportData.version || 1,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── PULL ──
    if (action === 'pull') {
      await verifyAdmin(supabase, req);

      const body = await req.json();
      const { remote_url, remote_admin_token, mode } = body;

      if (!remote_url) {
        return new Response(JSON.stringify({ error: 'URL del panel remoto requerida' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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
            dvr_enabled: ch.dvr_enabled || false,
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
  } catch (err: any) {
    const status = err.status || 500;
    const message = err.message || 'Error interno';
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
