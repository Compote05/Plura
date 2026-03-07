import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

async function getEmbedding(text: string, ollamaUrl: string): Promise<number[] | null> {
    try {
        const res = await fetch(`${ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen3-embedding:4b',
                prompt: text
            })
        });
        if (!res.ok) {
            console.error("Ollama embedding error:", await res.text());
            return null;
        }
        const data = await res.json();
        return data.embedding;
    } catch (e) {
        console.error("Failed to connect to Ollama for embeddings:", e);
        return null;
    }
}

export async function POST(req: Request) {
    // 1. Rate Limiting Check (max 60 requests per minute)
    if (!(await checkRateLimit(req, 60, 60000, 'ollama-chat'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Authentication Check
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

    try {
        // Attempt to fetch global admin setting for LLM API
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'llm_default_api')
            .single();

        if (setting?.value?.url) {
            OLLAMA_URL = setting.value.url;
        }
    } catch (e) {
        console.warn("Failed to fetch global LLM settings, falling back to default.", e);
    }

    try {
        const body = await req.json();
        const { model, messages, stream, think, attachedDocIds } = body;

        // --- RAG Subsystem: Context Injection ---
        if (attachedDocIds && attachedDocIds.length > 0 && messages && messages.length > 0) {
            try {
                const lastMessage = messages[messages.length - 1];

                if (lastMessage.role === 'user') {
                    const queryText = lastMessage.content;
                    const queryEmbedding = await getEmbedding(queryText, OLLAMA_URL);

                    if (queryEmbedding) {
                        const { data: chunks, error } = await supabaseAdmin.rpc('match_document_chunks', {
                            query_embedding: queryEmbedding,
                            match_count: 5,
                            filter_document_ids: attachedDocIds
                        });

                        if (error) {
                            console.error('Error fetching document chunks:', error);
                        } else if (chunks && chunks.length > 0) {
                            // Build context string from retrieved chunks
                            const contextString = chunks.map((c: any) => c.content).join("\n\n---\n\n");

                            // Inject Context into the last message
                            lastMessage.content = `You are a helpful assistant. Use the following context documents to help answer the user's question. If the answer is not contained within the documents, answer to the best of your ability but mention that the provided context does not cover it entirely.\n\nContext Documents:\n${contextString}\n\nUser Question:\n${queryText}`;
                        }
                    }
                }
            } catch (ragError) {
                console.error("RAG Subsystem failed (perhaps network timeout), continuing without context:", ragError);
            }
        }
        // --- End of RAG Subsystem ---

        // Prepare the payload for Ollama
        const ollamaPayload: any = {
            model,
            messages,
            stream,
            think
        };

        // Only add options if think is explicitly true
        if (think) {
            ollamaPayload.options = { num_predict: 4096 };
        }

        // Pass the request directly to Ollama
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(ollamaPayload),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Ollama sent an error: ${response.statusText}` },
                { status: response.status }
            );
        }

        // Return the streaming response directly back to the client
        return new Response(response.body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/json',
                // Ensure proper streaming headers
                'Transfer-Encoding': 'chunked',
            },
        });

    } catch (error) {
        console.error("Failed to connect to Ollama chat api:", error);
        return NextResponse.json(
            { error: "Failed to connect to Ollama. Make sure it is running." },
            { status: 500 }
        );
    }
}
