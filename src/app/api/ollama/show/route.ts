import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    // 1. Rate Limiting Check
    if (!(await checkRateLimit(req, 60, 60000, 'ollama-show'))) {
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
        console.warn("Failed to fetch global LLM settings in show route, falling back to default.", e);
    }

    try {
        const body = await req.json();

        const response = await fetch(`${OLLAMA_URL}/api/show`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Ollama sent an error: ${response.statusText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Failed to connect to Ollama show api:", error);
        return NextResponse.json(
            { error: "Failed to connect to Ollama. Make sure it is running." },
            { status: 500 }
        );
    }
}
