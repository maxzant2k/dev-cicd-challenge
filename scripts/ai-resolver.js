#!/usr/bin/env node
/**
 * AI Resolver — bimodal pipeline assistant.
 *
 *   analyze <log>   Parse a failure log and emit artifacts/incident_report.{md,json}.
 *                   Used by CI when the test job fails (existing behavior).
 *
 *   verify          Run the test suite via `jest --json`, validate critical project
 *                   invariants, and emit artifacts/pre_deploy_verification.{md,json}.
 *                   Exits 0 (GO) or 1 (NO-GO). Used as the pre-production gate.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

const MODE = process.argv[2] || 'analyze';

function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function writeReport(basename, markdown, json) {
  ensureArtifactsDir();
  const mdPath = path.join(ARTIFACTS_DIR, `${basename}.md`);
  const jsonPath = path.join(ARTIFACTS_DIR, `${basename}.json`);
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  return { mdPath, jsonPath };
}

// ============================================================
// ANALYZE MODE — regex-based log post-mortem
// ============================================================

class IncidentAnalyzer {
  constructor(logContent) {
    this.logs = logContent;
    this.lower = logContent.toLowerCase();
    this.analysis = {
      stepFailed: 'Unknown',
      probableRootCause: [],
      suggestedFixes: [],
      severity: 'medium',
      confidence: 'low',
      rollbackRequired: false,
      commonErrors: []
    };
  }

  analyze() {
    this.detectFailurePoint();
    this.detectErrorPatterns();
    this.generateSuggestions();
    this.assessSeverity();
    return this.analysis;
  }

  detectFailurePoint() {
    if (this.lower.includes('fail') && this.lower.includes('test')) {
      this.analysis.stepFailed = 'Unit Tests';
    } else if (this.lower.includes('docker') || this.lower.includes('build')) {
      this.analysis.stepFailed = 'Docker Build';
    } else if (this.lower.includes('deploy') || this.lower.includes('push')) {
      this.analysis.stepFailed = 'Deployment';
    } else if (this.lower.includes('health') && this.lower.includes('check')) {
      this.analysis.stepFailed = 'Health Check';
    } else if (this.lower.includes('timeout')) {
      this.analysis.stepFailed = 'Timeout/Performance';
    }
  }

  detectErrorPatterns() {
    const patterns = [
      {
        regex: /expected[:\s]+(\d+)[\s\S]*?received[:\s]+(\d+)/i,
        handler: (match) => {
          this.analysis.commonErrors.push(`Status code mismatch: expected ${match[1]}, got ${match[2]}`);
          if (match[2] === '500') {
            this.analysis.probableRootCause.push('Server error - application returned HTTP 500');
            this.analysis.probableRootCause.push('Likely cause: missing APP_ENV environment variable');
            this.analysis.suggestedFixes.push('Ensure APP_ENV is set in test/runtime environment');
            this.analysis.confidence = 'high';
          }
        }
      },
      {
        regex: /app_env|environment|env.*missing|not.*set/i,
        handler: () => {
          this.analysis.commonErrors.push('Missing environment variable');
          this.analysis.probableRootCause.push('Required environment variable (APP_ENV) is not set');
          this.analysis.suggestedFixes.push('Set APP_ENV in test environment: `process.env.APP_ENV = "test"`');
        }
      },
      {
        regex: /port.*already.*use|eaddrinuse|3000|3001/i,
        handler: () => {
          this.analysis.commonErrors.push('Port binding conflict');
          this.analysis.probableRootCause.push('Port is already in use by another process');
          this.analysis.suggestedFixes.push('Kill the process using the port or use a different port');
        }
      },
      {
        regex: /npm.*not.*found|command.*not.*found/i,
        handler: () => {
          this.analysis.commonErrors.push('Missing dependency');
          this.analysis.probableRootCause.push('npm dependencies not installed');
          this.analysis.suggestedFixes.push('Run: npm install');
        }
      },
      {
        regex: /dockerfile|docker.*build|from.*node/i,
        handler: () => {
          this.analysis.stepFailed = 'Docker Build';
          this.analysis.commonErrors.push('Docker build issue');
        }
      },
      {
        regex: /timeout|timed.*out|timeout exceeded/i,
        handler: () => {
          this.analysis.severity = 'high';
          this.analysis.commonErrors.push('Timeout detected');
          this.analysis.probableRootCause.push('Operation took too long or service is unresponsive');
          this.analysis.suggestedFixes.push('Increase timeout or optimize performance');
        }
      },
      {
        regex: /module.*not.*found|require.*error/i,
        handler: () => {
          this.analysis.commonErrors.push('Module import error');
          this.analysis.probableRootCause.push('Required module is missing or path is incorrect');
          this.analysis.suggestedFixes.push('Verify package.json and run npm install');
        }
      },
      {
        regex: /permission.*denied|eacces|access/i,
        handler: () => {
          this.analysis.commonErrors.push('Permission denied error');
          this.analysis.probableRootCause.push('Insufficient permissions to access file or execute command');
        }
      }
    ];

    patterns.forEach((pattern) => {
      if (pattern.regex.test(this.logs)) {
        const match = this.logs.match(pattern.regex);
        pattern.handler(match);
      }
    });

    if (this.analysis.probableRootCause.length === 0) {
      this.analysis.probableRootCause.push('Unknown - requires manual investigation');
    }
  }

  generateSuggestions() {
    if (this.analysis.suggestedFixes.length > 0) return;
    switch (this.analysis.stepFailed) {
      case 'Unit Tests':
        this.analysis.suggestedFixes = [
          'Review test output for specific assertions',
          'Ensure environment variables are properly set',
          'Verify app exports are correct'
        ];
        break;
      case 'Docker Build':
        this.analysis.suggestedFixes = [
          'Check Dockerfile syntax',
          'Verify base image exists and is accessible',
          'Ensure all required files are COPY/ADD-ed'
        ];
        break;
      case 'Health Check':
        this.analysis.suggestedFixes = [
          'Verify app is running and listening on correct port',
          'Check health endpoint response',
          'Review environment configuration'
        ];
        break;
      default:
        this.analysis.suggestedFixes = ['Review logs for more details', 'Check recent code changes'];
    }
  }

  assessSeverity() {
    if (this.analysis.commonErrors.length > 0) {
      this.analysis.confidence = 'high';
    } else if (this.analysis.stepFailed !== 'Unknown') {
      this.analysis.confidence = 'medium';
    }
    if (this.analysis.severity === 'high' && this.analysis.stepFailed === 'Health Check') {
      this.analysis.rollbackRequired = true;
    }
  }

  generateMarkdown() {
    const a = this.analysis;
    return [
      `# Incident Report\n\n**Generated:** ${new Date().toISOString()}\n`,
      `## Summary\n- **Failed Step:** ${a.stepFailed}\n- **Severity:** ${a.severity.toUpperCase()}\n- **Confidence:** ${a.confidence.toUpperCase()}\n`,
      `## Root Cause Analysis\n${a.probableRootCause.map((c) => `- ${c}`).join('\n')}\n`,
      `## Common Errors Detected\n${a.commonErrors.length > 0 ? a.commonErrors.map((e) => `- ${e}`).join('\n') : '- No specific errors detected'}\n`,
      `## Suggested Actions\n${a.suggestedFixes.map((fix, i) => `${i + 1}. ${fix}`).join('\n')}\n`,
      `## Rollback Required\n${a.rollbackRequired ? '**YES** - Immediate rollback recommended' : '**NO** - No rollback needed'}\n`,
      `## Recommended Next Steps\n1. Review the fixes above\n2. Apply the fix and re-run the pipeline\n3. Monitor health check after deployment\n4. If issues persist, escalate to team\n`
    ].join('\n');
  }

  generateJson() {
    return {
      timestamp: new Date().toISOString(),
      analysis: this.analysis,
      recommendations: {
        immediate_actions: this.analysis.suggestedFixes,
        rollback_required: this.analysis.rollbackRequired
      }
    };
  }
}

function runAnalyze() {
  const logPath = process.argv[3] || path.join(ROOT, 'logs', 'pipeline_failure.log');
  if (!fs.existsSync(logPath)) {
    console.error(`[analyze] Log file not found: ${logPath}`);
    process.exit(2);
  }
  const content = fs.readFileSync(logPath, 'utf8');
  const analyzer = new IncidentAnalyzer(content);
  const analysis = analyzer.analyze();
  const { mdPath, jsonPath } = writeReport('incident_report', analyzer.generateMarkdown(), analyzer.generateJson());

  console.log('[analyze] Incident report generated');
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  JSON:     ${jsonPath}`);
  console.log('');
  console.log(`  Step Failed:       ${analysis.stepFailed}`);
  console.log(`  Severity:          ${analysis.severity}`);
  console.log(`  Confidence:        ${analysis.confidence}`);
  console.log(`  Rollback Required: ${analysis.rollbackRequired}`);
}

// ============================================================
// VERIFY MODE — pre-deploy gate (run tests + invariants → GO/NO-GO)
// ============================================================

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function fileContains(rel, needle) {
  if (!fileExists(rel)) return false;
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(needle);
}

function runJest() {
  const env = { ...process.env, APP_ENV: process.env.APP_ENV || 'test', CI: 'true' };
  const result = spawnSync(
    'npx',
    ['--no-install', 'jest', '--json', '--silent', '--runInBand'],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

function parseJest(stdout) {
  // jest --json prints a single JSON object to stdout; isolate it defensively
  const first = stdout.indexOf('{');
  const last = stdout.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(stdout.slice(first, last + 1));
  } catch {
    return null;
  }
}

function extractFailureMessages(jestReport) {
  const failures = [];
  for (const suite of jestReport.testResults || []) {
    for (const t of suite.testResults || []) {
      if (t.status === 'failed') {
        failures.push({
          test: t.fullName || t.title,
          messages: (t.failureMessages || []).map((m) => m.split('\n').slice(0, 6).join('\n'))
        });
      }
    }
  }
  return failures;
}

function renderVerifyMarkdown(report) {
  const symbol = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
  const banner = report.verdict === 'GO' ? 'GO — production deploy allowed' : 'NO-GO — production deploy blocked';
  const lines = [];
  lines.push(`# Pre-Deploy Verification — ${banner}`);
  lines.push('');
  lines.push(`- **Pipeline stage:** ${report.stage}`);
  lines.push(`- **Started:** ${report.startedAt}`);
  lines.push(`- **Finished:** ${report.finishedAt}`);
  lines.push('');

  if (report.jest) {
    lines.push('## Test Suite (Jest)');
    lines.push(`- Total:   ${report.jest.numTotalTests}`);
    lines.push(`- Passed:  ${report.jest.numPassedTests}`);
    lines.push(`- Failed:  ${report.jest.numFailedTests}`);
    lines.push(`- Pending: ${report.jest.numPendingTests}`);
    lines.push('');
  }

  lines.push('## Checks');
  for (const c of report.checks) {
    lines.push(`- [${symbol[c.status]}] ${c.name} _(severity: ${c.severity})_`);
    if (c.details) {
      if (Array.isArray(c.details)) {
        for (const f of c.details) {
          lines.push(`  - \`${f.test}\``);
          for (const m of f.messages) {
            lines.push('    ```');
            m.split('\n').forEach((ln) => lines.push(`    ${ln}`));
            lines.push('    ```');
          }
        }
      } else {
        lines.push(`  - ${String(c.details).replace(/\n/g, ' ')}`);
      }
    }
  }
  lines.push('');

  lines.push('## Verdict');
  if (report.verdict === 'GO') {
    lines.push('All critical checks passed. **Production deploy may proceed.**');
  } else {
    lines.push('One or more critical checks failed. **Production deploy is blocked.**');
    lines.push('');
    lines.push('### Required actions');
    for (const c of report.checks.filter((c) => c.status === 'fail' && c.severity === 'critical')) {
      lines.push(`- Fix: ${c.name}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function runVerify() {
  const startedAt = new Date().toISOString();
  const checks = [];

  console.log('[verify] Stage 1/3 — checking critical project files');
  const criticalFiles = [
    'package.json',
    'src/app.js',
    'Dockerfile',
    '.github/workflows/ci.yml',
    '__tests__/app.test.js'
  ];
  for (const f of criticalFiles) {
    checks.push({
      id: `file:${f}`,
      name: `File present: ${f}`,
      status: fileExists(f) ? 'pass' : 'fail',
      severity: 'critical'
    });
  }

  console.log('[verify] Stage 2/3 — checking application invariants');
  checks.push({
    id: 'app:health-endpoint',
    name: 'Health endpoint /health defined in src/app.js',
    status: fileContains('src/app.js', '/health') ? 'pass' : 'fail',
    severity: 'critical'
  });
  checks.push({
    id: 'app:app-env-consumed',
    name: 'APP_ENV referenced in src/app.js',
    status: fileContains('src/app.js', 'APP_ENV') ? 'pass' : 'warn',
    severity: 'medium'
  });

  console.log('[verify] Stage 3/3 — running jest --json');
  const jest = runJest();
  const jestReport = parseJest(jest.stdout);

  if (!jestReport) {
    checks.push({
      id: 'jest:executed',
      name: 'Jest produced parseable JSON output',
      status: 'fail',
      severity: 'critical',
      details: (jest.stderr || jest.stdout || '').slice(0, 800)
    });
  } else {
    checks.push({
      id: 'jest:executed',
      name: 'Jest produced parseable JSON output',
      status: 'pass',
      severity: 'critical'
    });
    checks.push({
      id: 'jest:no-failures',
      name: `All Jest tests pass (${jestReport.numPassedTests}/${jestReport.numTotalTests})`,
      status: jestReport.success && jestReport.numFailedTests === 0 ? 'pass' : 'fail',
      severity: 'critical',
      details: jestReport.numFailedTests > 0 ? extractFailureMessages(jestReport) : undefined
    });
    const skipped = (jestReport.numPendingTests || 0) + (jestReport.numTodoTests || 0);
    checks.push({
      id: 'jest:no-skipped',
      name: `No skipped or todo tests (${skipped} found)`,
      status: skipped === 0 ? 'pass' : 'warn',
      severity: 'low'
    });
  }

  const criticalFails = checks.filter((c) => c.status === 'fail' && c.severity === 'critical');
  const verdict = criticalFails.length === 0 ? 'GO' : 'NO-GO';
  const finishedAt = new Date().toISOString();

  const json = {
    verdict,
    stage: 'pre-production',
    startedAt,
    finishedAt,
    checks,
    jest: jestReport
      ? {
          success: jestReport.success,
          numTotalTests: jestReport.numTotalTests,
          numPassedTests: jestReport.numPassedTests,
          numFailedTests: jestReport.numFailedTests,
          numPendingTests: jestReport.numPendingTests || 0
        }
      : null
  };

  const { mdPath, jsonPath } = writeReport('pre_deploy_verification', renderVerifyMarkdown(json), json);

  console.log('');
  console.log(`[verify] Verdict: ${verdict}`);
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  JSON:     ${jsonPath}`);

  if (criticalFails.length > 0) {
    console.log('');
    console.log('[verify] Critical failures:');
    for (const c of criticalFails) console.log(`  - ${c.name}`);
  }

  process.exit(verdict === 'GO' ? 0 : 1);
}

// ============================================================
// DISPATCH
// ============================================================

if (MODE === 'analyze') {
  runAnalyze();
} else if (MODE === 'verify') {
  runVerify();
} else {
  console.error(`Unknown mode: ${MODE}`);
  console.error('Usage:');
  console.error('  ai-resolver.js analyze [log_path]   Post-mortem on a failure log');
  console.error('  ai-resolver.js verify               Pre-deploy gate (exit 0 = GO, 1 = NO-GO)');
  process.exit(2);
}
