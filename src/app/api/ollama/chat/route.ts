import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

const RAG_API_URL = process.env.RAG_API_URL;

async function getEmbedding(text: string, ollamaUrl: string): Promise<number[] | null> {
    try {
        const res = await fetch(`${ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'qwen3-embedding:4b', prompt: text }),
        });
        if (!res.ok) return null;
        return (await res.json()).embedding;
    } catch {
        return null;
    }
}

async function getOllamaUrl(): Promise<string> {
    try {
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'llm_default_api')
            .single();
        if (setting?.value?.url) return setting.value.url;
    } catch { }
    return process.env.OLLAMA_URL || 'http://localhost:11434';
}

async function executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    token: string
): Promise<{ text: string; result_type: string; data: Record<string, unknown> }> {
    try {
        const res = await fetch(`${RAG_API_URL}/v1/capabilities/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tool_name: toolName, args }),
        });
        if (!res.ok) return { text: `Tool '${toolName}' failed.`, result_type: 'text', data: {} };
        return await res.json();
    } catch {
        return { text: `Tool '${toolName}' failed.`, result_type: 'text', data: {} };
    }
}

export async function POST(req: Request) {
    if (!(await checkRateLimit(req, 60, 60000, 'ollama-chat'))) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const OLLAMA_URL = await getOllamaUrl();
    const token = req.headers.get('Authorization')?.split(' ')[1] || '';

    try {
        const body = await req.json();
        const { model, messages, stream, think, attachedDocIds, activeCapabilityIds } = body;

        // --- RAG Subsystem ---
        if (attachedDocIds?.length > 0 && messages?.length > 0) {
            try {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage.role === 'user') {
                    const queryEmbedding = await getEmbedding(lastMessage.content, OLLAMA_URL);
                    if (queryEmbedding) {
                        const { data: chunks } = await supabaseAdmin.rpc('match_document_chunks', {
                            query_embedding: queryEmbedding,
                            match_count: 5,
                            filter_document_ids: attachedDocIds,
                        });
                        if (chunks?.length > 0) {
                            const contextString = chunks
                                .map((c: { content: string }) => c.content)
                                .join('\n\n---\n\n');
                            const queryText = lastMessage.content;
                            lastMessage.content = `You are a helpful assistant. Use the following context documents to help answer the user's question. If the answer is not contained within the documents, answer to the best of your ability but mention that the provided context does not cover it entirely.\n\nContext Documents:\n${contextString}\n\nUser Question:\n${queryText}`;
                        }
                    }
                }
            } catch { }
        }
        // --- End RAG ---

        // --- Capabilities / Tool Calling ---
        if (activeCapabilityIds?.length > 0) {
            let tools: unknown[] = [];
            try {
                const toolsRes = await fetch(
                    `${RAG_API_URL}/v1/capabilities/tools?ids=${activeCapabilityIds.join(',')}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                if (toolsRes.ok) {
                    tools = await toolsRes.json();
                } else {
                    console.error('[Capabilities] Tools fetch failed:', toolsRes.status, await toolsRes.text());
                }
            } catch (e) {
                console.error('[Capabilities] Tools fetch error:', e);
            }

            console.log(`[Capabilities] active=${activeCapabilityIds}, tools=${tools.length}`);

            if (tools.length > 0) {
                // Inject system prompt to instruct the model to use tools
                const systemPrompt = {
                    role: 'system',
                    content: 'You have access to real-time tools. When the user asks for current data (prices, news, market info, etc.), you MUST call the appropriate tool to get up-to-date information. Do not make up data — always use the tools provided.',
                };
                const messagesWithSystem = messages[0]?.role === 'system'
                    ? messages
                    : [systemPrompt, ...messages];

                // First pass: non-streaming to detect tool calls
                const firstPayload: Record<string, unknown> = { model, messages: messagesWithSystem, tools, stream: false };
                if (think) firstPayload.options = { num_predict: 4096 };

                const firstRes = await fetch(`${OLLAMA_URL}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(firstPayload),
                });

                if (!firstRes.ok) {
                    return NextResponse.json(
                        { error: `Ollama error: ${firstRes.statusText}` },
                        { status: firstRes.status }
                    );
                }

                const firstData = await firstRes.json();
                console.log('[Capabilities] Ollama first response:', JSON.stringify(firstData?.message).slice(0, 200));

                type OllamaToolCall = { function: { name: string; arguments: Record<string, unknown> } };
                const toolCalls = firstData.message?.tool_calls as OllamaToolCall[] | undefined;

                if (toolCalls && toolCalls.length > 0) {
                    console.log('[Capabilities] Tool calls detected:', toolCalls.map(tc => tc.function.name));
                    // Execute all tool calls
                    const toolResults: Array<{
                        tool_name: string;
                        result: { text: string; result_type: string; data: Record<string, unknown> };
                    }> = [];

                    for (const tc of toolCalls) {
                        const result = await executeToolCall(tc.function.name, tc.function.arguments, token);
                        toolResults.push({ tool_name: tc.function.name, result });
                    }

                    // Build updated conversation for final response
                    // tool messages require tool_name per Ollama spec
                    const updatedMessages = [
                        ...messagesWithSystem,
                        firstData.message, // assistant message with tool_calls intact
                        ...toolResults.map((tr) => ({
                            role: 'tool',
                            tool_name: tr.tool_name,
                            content: tr.result.text,
                        })),
                    ];

                    const encoder = new TextEncoder();
                    const readable = new ReadableStream({
                        async start(controller) {
                            // Emit tool result events first
                            for (const tr of toolResults) {
                                const event =
                                    JSON.stringify({
                                        type: 'tool_result',
                                        tool_name: tr.tool_name,
                                        result_type: tr.result.result_type,
                                        data: tr.result.data,
                                    }) + '\n';
                                controller.enqueue(encoder.encode(event));
                            }

                            // Stream final Ollama response
                            const finalPayload: Record<string, unknown> = {
                                model,
                                messages: updatedMessages,
                                stream: true,
                                think,
                            };
                            if (think) finalPayload.options = { num_predict: 4096 };

                            const finalRes = await fetch(`${OLLAMA_URL}/api/chat`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(finalPayload),
                            });

                            if (finalRes.body) {
                                const reader = finalRes.body.getReader();
                                while (true) {
                                    const { done, value } = await reader.read();
                                    if (done) break;
                                    controller.enqueue(value);
                                }
                            }
                            controller.close();
                        },
                    });

                    return new Response(readable, {
                        headers: {
                            'Content-Type': 'application/x-ndjson',
                            'Transfer-Encoding': 'chunked',
                        },
                    });
                }

                // No tool calls — wrap non-streaming response as a single NDJSON line
                const encoder = new TextEncoder();
                const fakeStream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(JSON.stringify(firstData) + '\n'));
                        controller.close();
                    },
                });
                return new Response(fakeStream, {
                    headers: { 'Content-Type': 'application/x-ndjson' },
                });
            }
        }
        // --- End Capabilities ---

        // Default: direct streaming pass-through
        const ollamaPayload: Record<string, unknown> = { model, messages, stream, think };
        if (think) ollamaPayload.options = { num_predict: 4096 };

        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ollamaPayload),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Ollama sent an error: ${response.statusText}` },
                { status: response.status }
            );
        }

        return new Response(response.body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/json',
                'Transfer-Encoding': 'chunked',
            },
        });
    } catch (error) {
        console.error('Failed to connect to Ollama chat api:', error);
        return NextResponse.json(
            { error: 'Failed to connect to Ollama. Make sure it is running.' },
            { status: 500 }
        );
    }
}
