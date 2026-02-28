import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function parseM3U(content: string) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  const channels: any[] = [];
  let currentName = '';
  let currentCategory = 'General';
  let currentLogo: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      currentName = nameMatch ? nameMatch[1].trim() : `Canal ${channels.length + 1}`;

      const groupMatch = line.match(/group-title="([^"]+)"/);
      currentCategory = groupMatch ? groupMatch[1] : 'General';

      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      currentLogo = logoMatch ? logoMatch[1] : null;
    } else if (!line.startsWith('#') && line.length > 0) {
      channels.push({
        name: currentName || `Canal ${channels.length + 1}`,
        url: line,
        category: currentCategory,
        logo_url: currentLogo,
        sort_order: channels.length,
        is_active: true,
      });
      currentName = '';
      currentCategory = 'General';
      currentLogo = null;
    }
  }

  return channels;
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

    // Verify admin
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

    // Check admin role
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles || !roles.some(r => r.role === 'admin')) {
      return new Response(JSON.stringify({ error: 'No eres administrador' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { m3u_content, m3u_url } = await req.json();
    let content = m3u_content;

    // Download from URL if provided
    if (m3u_url && !content) {
      const response = await fetch(m3u_url);
      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'No se pudo descargar la lista M3U' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      content = await response.text();
    }

    if (!content) {
      return new Response(JSON.stringify({ error: 'Proporciona m3u_content o m3u_url' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const channels = parseM3U(content);

    if (channels.length === 0) {
      return new Response(JSON.stringify({ error: 'No se encontraron canales en el contenido M3U' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Insert channels
    const { data: inserted, error: insertError } = await supabase
      .from('channels')
      .insert(channels)
      .select('id');

    if (insertError) {
      // Try one by one on batch error
      let count = 0;
      for (const ch of channels) {
        const { error } = await supabase.from('channels').insert(ch);
        if (!error) count++;
      }
      return new Response(JSON.stringify({ imported: count, total: channels.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ imported: inserted?.length || 0, total: channels.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error del servidor: ' + (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
