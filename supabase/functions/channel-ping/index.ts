const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FAILURE_THRESHOLD = 3; // Consecutive failures before auto-disable

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { channel_ids, auto_manage = true } = body;

    // Get channels to check (include inactive auto_disabled ones for recovery check)
    let query = supabase
      .from("channels")
      .select("id, name, url, logo_url, category, is_active, auto_disabled, consecutive_failures");

    if (channel_ids && channel_ids.length > 0) {
      query = query.in("id", channel_ids);
    } else {
      // Check both active channels AND auto-disabled ones (for recovery)
      query = query.or("is_active.eq.true,auto_disabled.eq.true");
    }

    const { data: channels, error } = await query;
    if (error) throw error;

    // Ping channels with concurrency limit to avoid saturating gateway
    const CONCURRENCY = 5;
    const channelList = channels || [];
    const results: any[] = [];

    for (let i = 0; i < channelList.length; i += CONCURRENCY) {
      const batch = channelList.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (ch) => {
        const start = Date.now();
        try {
          const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);

          if (isYouTube) {
            return {
              id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url,
              status: "online", response_time: 0, status_code: 200, error: null,
              was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures,
            };
          }

          const isTS = /\.ts(\?|$)/i.test(ch.url);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), isTS ? 15000 : 10000);

          const res = await fetch(ch.url, {
            method: "GET",
            signal: controller.signal,
            headers: {
              "User-Agent": "StreamBox-HealthCheck/1.0",
              ...(isTS ? {} : { "Range": "bytes=0-1024" }),
            },
          });

          if (isTS) {
            // For .ts streams: read just the first chunk to confirm data is flowing
            const reader = res.body?.getReader();
            if (reader) {
              try {
                const { value, done } = await reader.read();
                const gotBytes = value && value.length > 0;
                // Cancel the rest of the stream immediately
                await reader.cancel();
                clearTimeout(timeout);
                controller.abort();

                const responseTime = Date.now() - start;
                return {
                  id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url,
                  status: gotBytes ? "online" : "offline",
                  response_time: responseTime, status_code: res.status,
                  error: gotBytes ? null : "No data received from stream",
                  was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures,
                };
              } catch (_readErr) {
                await reader.cancel().catch(() => {});
                clearTimeout(timeout);
                // If we got a 200 but read failed, still count as online (stream started)
                const responseTime = Date.now() - start;
                return {
                  id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url,
                  status: res.status >= 200 && res.status < 400 ? "online" : "offline",
                  response_time: responseTime, status_code: res.status,
                  error: null,
                  was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures,
                };
              }
            }
          }

          clearTimeout(timeout);
          const responseTime = Date.now() - start;
          const isOk = res.status >= 200 && res.status < 400;

          return {
            id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url,
            status: isOk ? "online" : "offline",
            response_time: responseTime, status_code: res.status,
            error: isOk ? null : `HTTP ${res.status}`,
            was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures,
          };
        } catch (err) {
          return {
            id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url,
            status: "offline", response_time: Date.now() - start, status_code: 0,
            error: err.message || "Connection failed",
            was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures,
          };
        }
      })
      );
      results.push(...batchResults);
    }

    // Auto-manage: disable failing channels, re-enable recovered ones
    const autoActions = { disabled: [] as string[], reactivated: [] as string[] };

    if (auto_manage) {
      for (const r of results) {
        if (r.status === "offline") {
          const newFailures = (r.consecutive_failures || 0) + 1;
          const updates: Record<string, unknown> = {
            consecutive_failures: newFailures,
            last_checked_at: new Date().toISOString(),
          };

          if (newFailures >= FAILURE_THRESHOLD) {
            updates.is_active = false;
            updates.auto_disabled = true;
            autoActions.disabled.push(r.name);
          }

          await supabase.from("channels").update(updates).eq("id", r.id);
        } else if (r.status === "online") {
          // Re-enable if it was auto-disabled
          const updates: Record<string, unknown> = {
            consecutive_failures: 0,
            last_checked_at: new Date().toISOString(),
          };

          if (r.was_auto_disabled) {
            updates.is_active = true;
            updates.auto_disabled = false;
            autoActions.reactivated.push(r.name);
          }

          await supabase.from("channels").update(updates).eq("id", r.id);
        }
      }
    }

    // Log offline channels
    const offlineChannels = results.filter((r) => r.status === "offline");
    if (offlineChannels.length > 0) {
      await supabase.from("channel_health_logs").insert(
        offlineChannels.map((ch) => ({
          channel_id: ch.id,
          status: "error",
          response_code: ch.status_code,
          error_message: ch.error || "Canal no responde",
          checked_by: "system:auto-ping",
        }))
      );
    }

    const online = results.filter((r) => r.status === "online").length;
    const offline = results.filter((r) => r.status === "offline").length;

    return new Response(
      JSON.stringify({
        results,
        summary: { total: results.length, online, offline },
        auto_actions: autoActions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
