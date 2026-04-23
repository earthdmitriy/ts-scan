#!/usr/bin/env node

import { router } from "./router.js";

const args = process.argv.slice(2);
router(args);
