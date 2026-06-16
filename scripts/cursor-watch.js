#!/usr/bin/env node
/**
 * ローカル: node scripts/cursor-watch.js
 */
require('dotenv').config();
const cursorMonitor = require('../lib/cursor-monitor');

cursorMonitor
  .runCursorWatch()
  .then((report) => {
    console.log(report.text);
    console.log('\n--- JSON summary ---');
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          changeCount: report.changeCount,
          baselineOnly: report.baselineOnly,
          errors: report.errors,
          persistence: report.persistence,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
