import { supabaseAdmin } from './supabase-admin';

/**
 * Fetches the base URL for ComfyUI from admin settings or environment variables.
 */
async function getComfyUIUrl(): Promise<string> {
    try {
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'imgen_default_api')
            .single();

        if (setting?.value?.url) {
            return setting.value.url;
        }
    } catch (e) {
        console.warn("Failed to fetch ComfyUI URL from settings, using env default.", e);
    }
    return process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
}

/**
 * Fetches the base URL for Ollama from admin settings or environment variables.
 */
async function getOllamaUrl(): Promise<string> {
    try {
        const { data: setting } = await supabaseAdmin
            .from('admin_settings')
            .select('value')
            .eq('key', 'llm_default_api')
            .single();

        if (setting?.value?.url) {
            return setting.value.url;
        }
    } catch (e) {
        console.warn("Failed to fetch Ollama URL from settings, using env default.", e);
    }
    return process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
}

/**
 * Sends a request to ComfyUI to free its VRAM and unload models.
 */
export async function clearComfyUIVRAM() {
    console.log("[VRAM] Clearing ComfyUI VRAM...");
    const url = await getComfyUIUrl();
    try {
        const res = await fetch(`${url}/free`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                unload_models: true,
                free_memory: true
            })
        });
        if (!res.ok) {
            console.error("[VRAM] ComfyUI /free failed:", res.status, await res.text());
        } else {
            console.log("[VRAM] ComfyUI VRAM cleared successfully.");
        }
    } catch (e) {
        console.error("[VRAM] Failed to reach ComfyUI for VRAM clearing:", e);
    }
}

/**
 * Lists currently loaded models in Ollama and unloads them by setting keep_alive to 0.
 */
export async function clearOllamaVRAM() {
    console.log("[VRAM] Clearing Ollama VRAM...");
    const url = await getOllamaUrl();
    try {
        // 1. Get currently loaded models
        const psRes = await fetch(`${url}/api/ps`);
        if (!psRes.ok) {
            console.error("[VRAM] Ollama /api/ps failed:", psRes.status);
            return;
        }

        const psData = await psRes.json();
        const models = psData.models || [];

        if (models.length === 0) {
            console.log("[VRAM] No models loaded in Ollama.");
            return;
        }

        // 2. Unload each model
        for (const modelInfo of models) {
            console.log(`[VRAM] Unloading Ollama model: ${modelInfo.name}`);
            await fetch(`${url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelInfo.name,
                    keep_alive: 0
                })
            });
        }
        console.log("[VRAM] Ollama VRAM cleared.");
    } catch (e) {
        console.error("[VRAM] Failed to reach Ollama for VRAM clearing:", e);
    }
}
