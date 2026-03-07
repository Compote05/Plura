import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';

/**
 * Proxy route to serve private files from the 'library' bucket.
 * Usage: /api/library/{userId}/{folder}/{filename}
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const user = await verifyAuth(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // In Next.js 15, params is a Promise
    const { path: pathSegments } = await params;

    // Construct the full path using the AUTHENTICATED user's ID
    // This hides the user ID from the public URL for privacy
    const fullPath = `${user.id}/${pathSegments.join('/')}`;

    try {
        // Generate a signed URL for the private 'library' bucket
        // Expires in 1 hour (3600 seconds)
        const { data, error } = await supabaseAdmin.storage
            .from('library')
            .createSignedUrl(fullPath, 3600);

        if (error || !data) {
            console.error("Signed URL generation error:", error);
            return NextResponse.json({ error: "File not found or access error." }, { status: 404 });
        }

        return NextResponse.json({ signedUrl: data.signedUrl });

    } catch (err) {
        console.error("Storage proxy error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
