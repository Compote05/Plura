import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(req: Request) {
    // 1. Rate Limiting Check (Polling happens often: 120 per minute)
    if (!(await checkRateLimit(req, 120, 60000, 'tts-status'))) {
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

    const { searchParams } = new URL(req.url);
    const prompt_id = searchParams.get('prompt_id');

    if (!prompt_id) {
        return NextResponse.json({ error: "No prompt_id provided" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(prompt_id)) {
        return NextResponse.json({ error: "Invalid prompt_id format" }, { status: 400 });
    }

    try {
        const response = await fetch(`${COMFY_URL}/history/${prompt_id}`);

        if (!response.ok) {
            return NextResponse.json(
                { error: `ComfyUI error` },
                { status: response.status }
            );
        }

        const history = await response.json();

        // ComfyUI /history returns an empty object if the prompt_id is still queueing/processing
        if (!history || !history[prompt_id]) {
            return NextResponse.json({ status: 'processing' });
        }

        // If completed, find the output audio
        const outputs = history[prompt_id].outputs;

        // Scan the outputs for audio
        let filename = '';
        let subfolder = '';
        let type = '';

        for (const nodeId in outputs) {
            const outputNodes = outputs[nodeId];
            // Both 'audio' and 'images' arrays might be used by custom nodes, but typically for audio it's 'audio' or 'gifs' or custom.
            // Let's check for 'audio' first
            if (outputNodes.audio && outputNodes.audio.length > 0) {
                const aud = outputNodes.audio[0];
                filename = aud.filename;
                subfolder = aud.subfolder || '';
                type = aud.type || 'output';
                break;
            }
            // Fallback: sometimes custom audio nodes store output in the "images" array due to lack of standard audio type
            if (!filename && outputNodes.images && outputNodes.images.length > 0) {
                const file = outputNodes.images[0];
                if (file.filename && (file.filename.endsWith('.wav') || file.filename.endsWith('.mp3') || file.filename.endsWith('.flac'))) {
                    filename = file.filename;
                    subfolder = file.subfolder || '';
                    type = file.type || 'output';
                    break;
                }
            }
        }

        if (filename) {
            // Encode the subfolder just in case it contains slashes, empty subfolder shouldn't matter
            const audioUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
            return NextResponse.json({ status: 'done', audioUrl });
        } else {
            return NextResponse.json({ status: 'error', error: 'No audio found in outputs' });
        }

    } catch (error) {
        console.error("Failed to connect to ComfyUI api:", error);
        return NextResponse.json(
            { error: "Failed to connect to ComfyUI." },
            { status: 500 }
        );
    }
}
