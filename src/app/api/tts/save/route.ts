import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    // 1. Rate Limiting Check
    if (!(await checkRateLimit(req, 30, 60000, 'tts-save'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { audioUrl, prompt } = body;
        const userId = user.id; // Prevent ID Spoofing by using authenticated ID

        if (!audioUrl || !prompt) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // 3. SSRF Protection: ensure audioUrl starts with the allowed COMFY_URL
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
            console.warn("Failed to fetch global ComfyUI settings for SSRF check.", e);
        }

        if (!audioUrl.startsWith(COMFY_URL)) {
            // Because localhost might be resolved as 127.0.0.1 by some clients/fetch, 
            // do a slightly more lenient check if the configured COMFY_URL is a local address.
            const isLocalComfy = COMFY_URL.includes("localhost") || COMFY_URL.includes("127.0.0.1");
            const isLocalAudio = audioUrl.includes("localhost") || audioUrl.includes("127.0.0.1");

            if (!(isLocalComfy && isLocalAudio)) {
                return NextResponse.json({ error: "Invalid audio URL. SSRF protection blocked the request." }, { status: 403 });
            }
        }

        // 4. Fetch audio from temporary ComfyUI URL
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
            throw new Error(`Failed to fetch audio from ComfyUI: ${audioResponse.statusText}`);
        }

        const arrayBuffer = await audioResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Determine extension from URL if possible, default to wav
        let fileExt = 'wav';
        let mimeType = 'audio/wav';

        if (audioUrl.includes('.mp3')) {
            fileExt = 'mp3';
            mimeType = 'audio/mpeg';
        } else if (audioUrl.includes('.flac')) {
            fileExt = 'flac';
            mimeType = 'audio/flac';
        } else if (audioUrl.includes('.ogg')) {
            fileExt = 'ogg';
            mimeType = 'audio/ogg';
        }

        // 2. Generate unique filename and path (organized by user / audio folder)
        const fileName = `${Date.now()}_tts_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${userId}/audio/${fileName}`;

        // 4. Upload to Supabase Storage 'library' bucket (which is public)
        const { error: uploadError } = await supabaseAdmin.storage
            .from('library')
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: false
            });

        if (uploadError) {
            console.error("Storage upload error:", uploadError);
            return NextResponse.json({ error: "Storage upload failed: " + uploadError.message }, { status: 500 });
        }

        // Generate the secure proxy URL (anonymized/privacy-respecting)
        const permanentUrl = `/api/library/audio/${fileName}`;

        // 5. Save to database
        const { data: docData, error: dbError } = await supabaseAdmin
            .from('documents')
            .insert([{
                user_id: userId,
                filename: fileName,
                storage_path: filePath,
                size: buffer.length,
                content_type: mimeType,
                extracted_text: 'generated_audio' // Tag it clearly for TTS
            }])
            .select()
            .single();

        if (dbError) {
            console.error("Database insert error:", dbError);
            throw new Error(`Failed to insert document reference: ${dbError.message}`);
        }

        return NextResponse.json({
            success: true,
            permanentUrl: permanentUrl,
            documentId: docData.id
        });

    } catch (error: unknown) {
        console.error("TTS save route error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Something went wrong saving the audio." },
            { status: 500 }
        );
    }
}
