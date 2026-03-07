import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(req: Request) {
    // 1. Rate Limiting Check (Tags can be fetched frequently, perhaps 120/min limit)
    if (!(await checkRateLimit(req, 120, 60000, 'ollama-tags'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

    try {
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'llm_default_api')
            .single();

        if (setting?.value?.url) {
            OLLAMA_URL = setting.value.url;
        }
    } catch (e) {
        console.warn("Failed to fetch global LLM settings in tags route, falling back to default.", e);
    }

    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Failed to fetch tags from Ollama:", error);
        return NextResponse.json(
            { error: "Failed to connect to Ollama. Make sure it is running." },
            { status: 500 }
        );
    }
}
