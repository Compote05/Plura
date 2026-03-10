import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { clearComfyUIVRAM, clearOllamaVRAM } from '@/lib/vram';

export async function POST(req: Request) {
    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { target } = await req.json();

    if (target === 'comfyui') {
        await clearComfyUIVRAM();
    } else if (target === 'ollama') {
        await clearOllamaVRAM();
    } else {
        return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
}
