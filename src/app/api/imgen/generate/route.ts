import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import fs from 'fs';
import path from 'path';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    // 1. Rate Limiting Check (Stricter for image generation: 20 per minute)
    if (!(await checkRateLimit(req, 20, 60000, 'imgen-generate'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let COMFY_URL = process.env.COMFYUI_URL;

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
        console.warn("Failed to fetch global ImgGen settings, falling back to default.", e);
    }

    try {
        const { prompt: userPrompt, aspectRatio } = await req.json();

        // Check if workflow file exists
        const workflowPath = path.join(process.cwd(), 'public/workflows/imgen/flux-2.json');
        if (!fs.existsSync(workflowPath)) {
            return NextResponse.json({ error: "Workflow file missing" }, { status: 500 });
        }

        const workflowData = fs.readFileSync(workflowPath, 'utf8');
        const workflow = JSON.parse(workflowData);

        // Modify Prompt
        workflow["20"].inputs.text = userPrompt;

        // Modify Seed
        workflow["13"].inputs.noise_seed = Math.floor(Math.random() * 9007199254740991);

        // Modify Dimensions based on aspect ratio
        let width = 512;
        let height = 512;

        if (aspectRatio === "landscape") {
            width = 672;
            height = 384; // SDXL/Flux ideal landscape size
        } else if (aspectRatio === "vertical") {
            width = 384;
            height = 672; // vertical size
        }

        workflow["11"].inputs.value = width;
        workflow["12"].inputs.value = height;

        // Send to ComfyUI
        const response = await fetch(`${COMFY_URL}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: "plura_client_" + Date.now(),
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
