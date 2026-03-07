import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
    const listRes = await supabase.storage.from('documents').list();
    console.log("Bucket listing:", listRes.data?.[0]);
    if (listRes.error) {
         console.error("List error", listRes.error);
    }

    const { data } = supabase.storage.from('documents').getPublicUrl('test/foo.flac');
    console.log("Public URL:", data.publicUrl);
    
    // fetch it
    const res = await fetch(data.publicUrl);
    console.log("Fetch test/foo.flac status:", res.status);
    console.log("Fetch body:", await res.text());
}
run();
