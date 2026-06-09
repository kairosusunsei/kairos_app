#!/usr/bin/env node
/**
 * Daily X DM scout — writes reports/x-dm-scout-YYYY-MM-DD.md
 * Optional email via RESEND_API_KEY + KAIROS_SCOUT_NOTIFY_EMAIL
 *
 * Usage: node scripts/x-dm-scout.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { runDmScout, formatReportMarkdown, sendNotifyEmail } = require('../lib/x-dm-scout.js');

async function main() {
  const report = await runDmScout({ limit: 5 });
  if (!report.generatedAt && report.ok) {
    report.generatedAt = new Date().toISOString();
  }
  if (!report.generatedAt) {
    report.generatedAt = new Date().toISOString();
  }

  const md = formatReportMarkdown(report);
  const day = report.generatedAt.slice(0, 10);
  const reportsDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const outPath = path.join(reportsDir, `x-dm-scout-${day}.md`);
  const latestPath = path.join(reportsDir, 'x-dm-scout-latest.md');
  fs.writeFileSync(outPath, md, 'utf8');
  fs.writeFileSync(latestPath, md, 'utf8');

  console.log(`[x-dm-scout] wrote ${outPath}`);
  console.log(md);

  const notifyEmail = process.env.KAIROS_SCOUT_NOTIFY_EMAIL;
  if (notifyEmail) {
    const mail = await sendNotifyEmail(
      notifyEmail,
      `KAIROS X DM Scout — ${day} (${report.candidateCount || 0} candidates)`,
      md,
    );
    console.log('[x-dm-scout] email', mail);
  }

  process.exit(report.ok ? 0 : 2);
}

main().catch((err) => {
  console.error('[x-dm-scout] fatal', err);
  process.exit(1);
});
