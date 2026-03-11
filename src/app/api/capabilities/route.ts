import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const RAG_API_URL = process.env.RAG_API_URL;

export async function GET(req: Request) {
    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!RAG_API_URL) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });

    try {
        const pyRes = await fetch(`${RAG_API_URL}/v1/capabilities`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!pyRes.ok) return NextResponse.json({ error: 'Failed to fetch capabilities' }, { status: 502 });
        const capabilities = await pyRes.json();

        const { data: userCaps } = await supabaseAdmin
            .from('user_capabilities')
            .select('capability_id, enabled')
            .eq('user_id', user.id);

        const enabledMap: Record<string, boolean> = {};
        for (const row of userCaps || []) {
            enabledMap[row.capability_id] = row.enabled;
        }

        return NextResponse.json(
            capabilities.map((cap: Record<string, unknown>) => ({
                ...cap,
                enabled: enabledMap[cap.id as string] ?? false,
            }))
        );
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!RAG_API_URL) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });

    const { capability_id, enabled } = await req.json();
    if (!capability_id || typeof capability_id !== 'string' || typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Validate capability_id exists in the registry
    const pyRes = await fetch(`${RAG_API_URL}/v1/capabilities`, {
        headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);

    if (!pyRes?.ok) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });

    const knownCaps: { id: string }[] = await pyRes.json();
    const validIds = new Set(knownCaps.map((c) => c.id));
    if (!validIds.has(capability_id)) {
        return NextResponse.json({ error: 'Unknown capability' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
        .from('user_capabilities')
        .upsert(
            { user_id: user.id, capability_id, enabled },
            { onConflict: 'user_id,capability_id' }
        );

    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 });
    return NextResponse.json({ ok: true });
}
