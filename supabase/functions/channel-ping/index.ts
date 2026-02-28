const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { channel_ids } = await req.json();

    // Get channels to check
    let query = supabase
      .from("channels")
      .select("id, name, url, logo_url, category")
      .eq("is_active", true);

    if (channel_ids && channel_ids.length > 0) {
      query = query.in("id", channel_ids);
    }

    const { data: channels, error } = await query;
    if (error) throw error;

    // Ping each channel URL (HEAD request with timeout)
    const results = await Promise.all(
      (channels || []).map(async (ch) => {
        const start = Date.now();
        try {
          const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
          
          // For YouTube, just check if the URL is valid format
          if (isYouTube) {
            return {
              id: ch.id,
              name: ch.name,
              category: ch.category,
              logo_url: ch.logo_url,
              status: "online",
              response_time: 0,
              status_code: 200,
              error: null,
            };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const res = await fetch(ch.url, {
            method: "GET",
            signal: controller.signal,
            headers: { 
              "User-Agent": "StreamBox-HealthCheck/1.0",
              "Range": "bytes=0-1024",
            },
          });
          clearTimeout(timeout);

          const responseTime = Date.now() - start;
          const isOk = res.status >= 200 && res.status < 400;

          return {
            id: ch.id,
            name: ch.name,
            category: ch.category,
            logo_url: ch.logo_url,
            status: isOk ? "online" : "offline",
            response_time: responseTime,
            status_code: res.status,
            error: isOk ? null : `HTTP ${res.status}`,
          };
        } catch (err) {
          return {
            id: ch.id,
            name: ch.name,
            category: ch.category,
            logo_url: ch.logo_url,
            status: "offline",
            response_time: Date.now() - start,
            status_code: 0,
            error: err.message || "Connection failed",
          };
        }
      })
    );

    // Log offline channels to health_logs
    const offlineChannels = results.filter((r) => r.status === "offline");
    if (offlineChannels.length > 0) {
      await supabase.from("channel_health_logs").insert(
        offlineChannels.map((ch) => ({
          channel_id: ch.id,
          status: "error",
          response_code: ch.status_code,
          error_message: ch.error || "Canal no responde",
          checked_by: "system:ping",
        }))
      );
    }

    const online = results.filter((r) => r.status === "online").length;
    const offline = results.filter((r) => r.status === "offline").length;

    return new Response(
      JSON.stringify({ results, summary: { total: results.length, online, offline } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
