const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const streamUrl = url.searchParams.get("url");

    if (!streamUrl) {
      return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsedUrl = new URL(streamUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return new Response(JSON.stringify({ error: "Invalid URL protocol" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Proxying stream: ${streamUrl}`);

    // For live TS streams, request a limited chunk using Range header
    // This avoids edge function timeout on infinite streams
    const isLiveTs = /\.ts(\?|$)/i.test(streamUrl) || /\/\d+\.ts/.test(streamUrl);

    const fetchHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    // For live TS streams, use AbortController to limit download time
    const controller = new AbortController();
    let timeoutId: number | undefined;

    if (isLiveTs) {
      // Limit to 25 seconds to stay within edge function timeout
      timeoutId = setTimeout(() => controller.abort(), 25000);
      fetchHeaders["Range"] = "bytes=0-2097152"; // Request up to 2MB
    }

    const response = await fetch(streamUrl, {
      headers: fetchHeaders,
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok && response.status !== 206) {
      return new Response(JSON.stringify({ error: `Stream returned ${response.status}` }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = response.headers.get("Content-Type") || "video/mp2t";

    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (error) {
    // Don't log abort errors as they're expected for live streams
    if (error.name !== "AbortError") {
      console.error("Proxy error:", error);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
