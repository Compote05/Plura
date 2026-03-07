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
        // const workflowPath = path.join(process.cwd(), 'public/workflows/imgen/flux-2.json');
        const workflowPath = path.join(process.cwd(), 'public/workflows/imgen/z-image.json');
        if (!fs.existsSync(workflowPath)) {
            return NextResponse.json({ error: "Workflow file missing" }, { status: 500 });
        }

        const workflowData = fs.readFileSync(workflowPath, 'utf8');
        const workflow = JSON.parse(workflowData);

        // Modify Dimensions based on aspect ratio
        let width = 1024;
        let height = 1024;

        if (aspectRatio === "landscape") {
            width = 1216;
            height = 832;
        } else if (aspectRatio === "vertical") {
            width = 832;
            height = 1216;
        }

        // ============== Flux Klein ==============
        // Modify Prompt
        // workflow["12"].inputs.text = userPrompt;

        // Modify Seed
        // workflow["3"].inputs.noise_seed = Math.floor(Math.random() * 9007199254740991);

        // workflow["7"].inputs.value = width;
        // workflow["8"].inputs.value = height;

        // ============ Z Image Turbo =============
        // Modify Prompt
        workflow["5"].inputs.text = userPrompt;

        // Modify Seed
        workflow["8"].inputs.seed = Math.floor(Math.random() * 9007199254740991);

        workflow["6"].inputs.width = width;
        workflow["6"].inputs.height = height;


        // Send to ComfyUI
        const response = await fetch(`${COMFY_URL}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: "aihub_client_" + Date.now(),
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
