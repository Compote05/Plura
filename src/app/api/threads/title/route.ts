import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    // 1. Rate Limiting Check
    if (!(await checkRateLimit(req, 20, 60000, 'threads-title'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { messages, model, chat_id } = body;
        const actualUserId = user.id; // Enforce user ID from token

        if (!messages || messages.length < 2) {
            return NextResponse.json({ error: "Insufficient messages to generate title" }, { status: 400 });
        }
        if (!chat_id) {
            return NextResponse.json({ error: "Missing chat_id" }, { status: 400 });
        }

        // Determine the Ollama URL, checking admin settings if necessary, or just using localhost default
        let ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

        try {
            // Attempt to fetch global admin setting for LLM API
            const { data: setting } = await supabaseAdmin
                .from('admin_settings')
                .select('value')
                .eq('key', 'llm_default_api')
                .single();

            if (setting?.value?.url) {
                ollamaUrl = setting.value.url;
            }
        } catch (e) {
            console.warn("Failed to fetch global LLM settings for title generation, falling back to default.", e);
        }

        const userContent = messages[0].content.slice(0, 500);
        const assistantContent = messages[1].content.slice(0, 500);

        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                stream: false,
                think: false,
                messages: [
                    {
                        role: "system",
                        content: "You are a conversation title generator. Given a conversation between a user and an assistant, generate a short, explicit title (max 6 words). Respond ONLY with the JSON format requested. Also the title need to be in the same langage as the user."
                    },
                    {
                        role: "user",
                        content: `Conversation:\nUser: ${userContent}\nAssistant: ${assistantContent}\n\nGenerate a concise title for this conversation.`
                    }
                ],
                format: {
                    type: "object",
                    properties: {
                        title: { type: "string" }
                    },
                    required: ["title"]
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();

        let generatedTitle: string;
        try {
            const parsed = JSON.parse(data.message.content);
            generatedTitle = parsed.title?.trim() || "";
        } catch {
            generatedTitle = "";
        }

        if (!generatedTitle) {
            generatedTitle = messages[0].content.split(" ").slice(0, 5).join(" ").trim();
        }

        // Update the Supabase thread with the new title
        const { error: dbError } = await supabaseAdmin
            .from('threads')
            .update({ title: generatedTitle })
            .eq('id', chat_id)
            .eq('user_id', actualUserId);

        if (dbError) {
            console.error("Failed to update thread title in DB:", dbError);
            throw new Error("Failed to update database");
        }

        return NextResponse.json({ title: generatedTitle });

    } catch (error: unknown) {
        console.error("Title generation error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate title" }, { status: 500 });
    }
}
