#!/usr/bin/env node
/**
 * `taptana-mcp`: el MCP de Taptana por stdio. Se conecta a un Taptana que ya está corriendo.
 *
 *   TAPTANA_URL   dónde está Taptana (por defecto http://localhost:4321)
 *   TAPTANA_KEY   la llave del panel, si Taptana está en otra computadora o en Docker
 */

import { runStdio } from './stdio.js';

await runStdio({ url: process.env['TAPTANA_URL'], key: process.env['TAPTANA_KEY'] });
