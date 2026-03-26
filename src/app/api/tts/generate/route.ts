import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import fs from 'fs';
import path from 'path';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    // 1. Rate Limiting Check
    if (!(await checkRateLimit(req, 20, 60000, 'tts-generate'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let COMFY_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8000';

    try {
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'imgen_default_api')
            .single();

        if (setting?.value?.url) {
            COMFY_URL = setting.value.url;
        }
    } catch (e) {
        console.warn("Failed to fetch global ComfyUI settings, falling back to default.", e);
    }

    try {
        const { prompt: userPrompt } = await req.json();

        if (!userPrompt || !userPrompt.trim()) {
            return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
        }

        // Check if workflow file exists
        const workflowPath = path.join(process.cwd(), 'public/workflows/tts/tts-custom.json');
        if (!fs.existsSync(workflowPath)) {
            return NextResponse.json({ error: "TTS Workflow file missing" }, { status: 500 });
        }

        const workflowData = fs.readFileSync(workflowPath, 'utf8');
        const workflow = JSON.parse(workflowData);

        // Modify Prompt inside node "1"
        if (workflow["1"] && workflow["1"].inputs) {
            workflow["1"].inputs.text = userPrompt;

            // Randomize seed if it exists to ensure different generations
            if (workflow["1"].inputs.seed !== undefined) {
                workflow["1"].inputs.seed = Math.floor(Math.random() * 9007199254740991);
            }
        } else {
            return NextResponse.json({ error: "Invalid TTS Workflow structure" }, { status: 500 });
        }


        // Send to ComfyUI
        console.log("[TTS] Sending to ComfyUI at:", COMFY_URL);
        const response = await fetch(`${COMFY_URL}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: "plura_tts_client_" + Date.now(),
                prompt: workflow
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            return NextResponse.json(
                { error: `ComfyUI error: ${errText}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        // Returns the prompt_id
        return NextResponse.json({ prompt_id: data.prompt_id });

    } catch (error) {
        console.error("Failed to connect to ComfyUI api:", error);
        return NextResponse.json(
            { error: "Failed to connect to ComfyUI. Make sure it is running." },
            { status: 500 }
        );
    }
}
