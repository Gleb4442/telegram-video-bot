import { afterEach, expect, it, vi } from 'vitest';
import handler from '../api/inngest.js';
afterEach(()=>vi.unstubAllEnvs());
it('rejects unsigned worker execution requests',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('INNGEST_SIGNING_KEY','signkey-prod-'+'a'.repeat(64));
 const response=await handler(new Request('https://app.test/api/inngest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:{name:'telegram/update',data:{update:{update_id:999}}}})}) as any,undefined);
 expect(response.status).toBe(401);
});
