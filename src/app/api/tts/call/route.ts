import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAuth } from '@/lib/auth';

export async function POST(req: Request) {
    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { text } = await req.json();
    if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });

    const COMFY_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8000';

    const workflowPath = path.join(process.cwd(), 'public/workflows/tts/tts-call.json');
    if (!fs.existsSync(workflowPath)) {
        return NextResponse.json({ error: "tts-call workflow missing" }, { status: 500 });
    }

    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

    // Node "39" is the TTS node in tts-call.json
    if (!workflow["39"]?.inputs) {
        return NextResponse.json({ error: "Invalid tts-call workflow structure" }, { status: 500 });
    }

    workflow["39"].inputs.text = text;
    workflow["39"].inputs.seed = Math.floor(Math.random() * 9007199254740991);

    try {
        const res = await fetch(`${COMFY_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: `plura_call_tts_${Date.now()}`,
                prompt: workflow,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("[tts/call] ComfyUI error:", errText);
            return NextResponse.json({ error: `ComfyUI error: ${errText}` }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json({ prompt_id: data.prompt_id });
    } catch (err) {
        console.error("[tts/call] Failed to reach ComfyUI:", err);
        return NextResponse.json({ error: "ComfyUI unreachable" }, { status: 503 });
    }
}
