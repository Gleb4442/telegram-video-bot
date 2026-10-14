import { serve } from "inngest/next";
import { inngest, processUpdate } from "../src/services/jobs.js";
export const config = { maxDuration: 300 };
// Signed requests verified by SDK; Inngest's Next adapter accepts Vercel Node req/res.
export default serve({ client: inngest, functions: [processUpdate] });
