import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit } from '@/lib/rate-limit';

const RAG_API_URL = process.env.RAG_API_URL;

export async function POST(req: Request) {
    if (!(await checkRateLimit(req, 30, 60000, 'capabilities-execute'))) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { tool_name, capability_id, args } = body;

    if (!tool_name || typeof tool_name !== 'string') {
        return NextResponse.json({ error: 'Missing tool_name' }, { status: 400 });
    }

    // Verify the user has the capability enabled
    if (capability_id) {
        const { data } = await supabaseAdmin
            .from('user_capabilities')
            .select('enabled')
            .eq('user_id', user.id)
            .eq('capability_id', capability_id)
            .single();

        if (!data?.enabled) {
            return NextResponse.json({ error: 'Capability not enabled' }, { status: 403 });
        }
    }

    if (!RAG_API_URL) {
        return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }

    try {
        const res = await fetch(`${RAG_API_URL}/v1/capabilities/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ tool_name, capability_id, args }),
        });

        if (!res.ok) {
            return NextResponse.json({ error: 'Execution failed' }, { status: res.status });
        }

        return NextResponse.json(await res.json());
    } catch {
        return NextResponse.json({ error: 'Failed to execute tool' }, { status: 500 });
    }
}
