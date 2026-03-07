/**
 * API Integration Layer for AIHub
 * 
 * This file contains the connection points for the external AI services:
 * - Text/Chat: OpenAI-compatible endpoint (e.g., local Ollama instance)
 * - Image Generation: ComfyUI API endpoint
 */

// Configure these via environment variables in production
const OLLAMA_OPENAI_COMPAT_URL = process.env.NEXT_PUBLIC_OLLAMA_URL || "http://localhost:11434/v1";
const COMFYUI_URL = process.env.NEXT_PUBLIC_COMFYUI_URL || "http://127.0.0.1:8000";

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * Send a chat completion request to the OpenAI-compatible endpoint.
 * Note: To use streaming in a real scenario, you'd use the fetch API with readers.
 */
export async function generateChatResponse(messages: ChatMessage[], model = "llama3") {
    try {
        const response = await fetch(`${OLLAMA_OPENAI_COMPAT_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages,
                stream: false, // Set to true for actual streaming
            }),
        });

        if (!response.ok) throw new Error("Chat request failed");
        return await response.json();
    } catch (error) {
        console.error("Chat API Error:", error);
        throw error;
    }
}

/**
 * Image generation request to ComfyUI
 * (ComfyUI requires submitting a workflow format JSON structure mapping to nodes)
 */
export async function generateImage(prompt: string) {
    // This is a placeholder for the actual ComfyUI Prompt workflow JSON
    const comfyUiWorkflowObject = {
        // Client ID, positive/negative prompts, seed, etc.
        prompt,
    };

    try {
        const response = await fetch(`${COMFYUI_URL}/prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(comfyUiWorkflowObject),
        });

        if (!response.ok) throw new Error("Image generation failed");
        return await response.json();
    } catch (error) {
        console.error("ComfyUI API Error:", error);
        throw error;
    }
}
