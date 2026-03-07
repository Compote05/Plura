import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

const RAG_API_URL = process.env.RAG_API_URL;

export async function POST(req: Request) {
    if (!(await checkRateLimit(req, 20, 60000, 'doc-upload'))) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "Missing file" }, { status: 400 });
        }

        if (file.size > 100 * 1024 * 1024) {
            return NextResponse.json({ error: "File size exceeds 100MB limit." }, { status: 413 });
        }

        // Forward file to Python RAG API for processing (extract + chunk + embed + store)
        const token = req.headers.get('Authorization')?.split(' ')[1];
        const ragFormData = new FormData();
        ragFormData.append('file', file);

        const ragRes = await fetch(`${RAG_API_URL}/v1/documents`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: ragFormData,
        });

        if (!ragRes.ok) {
            const err = await ragRes.json().catch(() => ({ detail: ragRes.statusText }));
            return NextResponse.json(
                { error: err.detail || "RAG API error" },
                { status: ragRes.status }
            );
        }

        // Returns { task_id, status, filename, message }
        const data = await ragRes.json();
        return NextResponse.json(data);

    } catch (error: unknown) {
        console.error("Document upload route error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Something went wrong during file upload." },
            { status: 500 }
        );
    }
}

// Poll task status from RAG API
export async function GET(req: Request) {
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('task_id');

    if (!taskId) {
        return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
        return NextResponse.json({ error: "Invalid task_id format" }, { status: 400 });
    }

    try {
        const token = req.headers.get('Authorization')?.split(' ')[1];

        const res = await fetch(`${RAG_API_URL}/v1/documents/tasks/${taskId}`, {
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
        });

        if (!res.ok) {
            return NextResponse.json({ error: "Task not found" }, { status: res.status });
        }

        // Returns { task_id, status, filename, document_id, chunks_created, error }
        const data = await res.json();
        return NextResponse.json(data);

    } catch (error: unknown) {
        console.error("Task status error:", error);
        return NextResponse.json({ error: "Failed to check task status" }, { status: 500 });
    }
}
