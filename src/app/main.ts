/* /folio/ — the whole editor. The shell, in its full mode: landing, replay, every tool.
   The three mini tool pages are the same shell with a different mode (src/core/modes.ts). */
import { FOLIO_MODE } from '../core/modes.js';
import { bootShell } from './shell.js';

bootShell(FOLIO_MODE);
