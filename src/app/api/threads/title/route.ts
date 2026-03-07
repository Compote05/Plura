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

        // Prepare the prompt for the model
        const titlePrompt = `Create a short summary to name this conversation. The idea is that we will use it as the title for the conversation list, so it needs to be short and fairly explicit. It doesn't have to repeat the user's question word for word, but it does need to be explicit. Do not use generic titles like "New Chat" or "Conversation".

Conversation:
User: ${messages[0].content}
Assistant: ${messages[1].content}`;

        // Call Ollama API
        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: titlePrompt }],
                stream: false,
                format: {
                    type: "object",
                    properties: {
                        title: { type: "string" }
                    },
                    required: ["title"]
                },
                options: {
                    temperature: 1, // Lower temperature for more deterministic/consistent titles
                    num_predict: 50 // Keep the output short
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();

        // Parse the generated JSON content
        let generatedTitle = "New Chat";
        try {
            // Ollama with a JSON schema format returns the JSON string directly in content
            const parsedContent = JSON.parse(data.message.content);
            if (parsedContent && typeof parsedContent.title === 'string' && parsedContent.title.trim() !== "") {
                generatedTitle = parsedContent.title.trim();
            }
        } catch (_) {
            console.error("Failed to parse JSON title from Ollama:", data.message.content);
            // Fallback: try to just grab the raw string and strip weird chars if it failed JSON validation
            generatedTitle = data.message.content.replace(/["'{}]/g, '').replace('title:', '').trim();
            if (generatedTitle.length > 50) generatedTitle = generatedTitle.substring(0, 50) + "...";
            if (!generatedTitle) generatedTitle = "New Chat";
        }

        // Extremely generic safeguard
        if (generatedTitle.toLowerCase() === "new chat" || generatedTitle.toLowerCase() === "conversation") {
            // Fallback to the first few words of the user prompt if the AI failed completely
            generatedTitle = messages[0].content.split(" ").slice(0, 5).join(" ").replace(/[^a-zA-Z0-9 ]/g, "").trim() + "...";
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
