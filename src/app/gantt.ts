/* /gantt/ — the shell scoped to ONE roadmap block (docs/SITE.md, "Mini tools"). */
import { GANTT_MODE } from '../core/modes.js';
import { bootShell } from './shell.js';

bootShell(GANTT_MODE);
