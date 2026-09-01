/* /draw/ — the shell scoped to ONE drawing block (docs/SITE.md, "Mini tools"). */
import { DRAW_MODE } from '../core/modes.js';
import { bootShell } from './shell.js';

bootShell(DRAW_MODE);
