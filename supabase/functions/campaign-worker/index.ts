import { engineHandler } from '../_shared/campaign-engine.ts';
Deno.serve(engineHandler('worker'));
