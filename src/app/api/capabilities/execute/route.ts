import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';

const RAG_API_URL = process.env.RAG_API_URL;

export async function POST(req: Request) {
    const user = await verifyAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const token = req.headers.get('Authorization')?.split(' ')[1];
    const body = await req.json();

    try {
        const res = await fetch(`${RAG_API_URL}/v1/capabilities/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            return NextResponse.json({ error: err.detail || 'Execution error' }, { status: res.status });
        }

        return NextResponse.json(await res.json());
    } catch {
        return NextResponse.json({ error: 'Failed to execute tool' }, { status: 500 });
    }
}
