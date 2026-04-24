const fs = require('fs');
const path = require('path');

const logPath = process.argv[2] || path.join(__dirname, '..', 'logs', 'pipeline_failure.log');
const outputPathMd = path.join(__dirname, '..', 'artifacts', 'incident_report.md');
const outputPathJson = path.join(__dirname, '..', 'artifacts', 'incident_report.json');

/**
 * AI-Powered Incident Analyzer
 * Analyzes pipeline/deployment logs to identify root causes and suggest fixes
 */
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
      commonErrors: [],
      detailedAnalysis: ''
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
    // Detect which step failed
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
          this.analysis.suggestedFixes.push('Kill process using port or use different port');
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
          this.analysis.suggestedFixes.push('Verify package.json and npm install');
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

    patterns.forEach(pattern => {
      if (pattern.regex.test(this.logs)) {
        const match = this.logs.match(pattern.regex);
        pattern.handler(match);
      }
    });

    // If no specific pattern matched, add generic cause
    if (this.analysis.probableRootCause.length === 0) {
      this.analysis.probableRootCause.push('Unknown - requires manual investigation');
    }
  }

  generateSuggestions() {
    if (this.analysis.suggestedFixes.length === 0) {
      // Generic suggestions based on step failed
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
            'Ensure all required files are COPY/ADD\'d'
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
  }

  assessSeverity() {
    // Set confidence based on pattern matches
    if (this.analysis.commonErrors.length > 0) {
      this.analysis.confidence = 'high';
    } else if (this.analysis.stepFailed !== 'Unknown') {
      this.analysis.confidence = 'medium';
    }

    // Assess if rollback is needed
    if (this.analysis.severity === 'high' && this.analysis.stepFailed === 'Health Check') {
      this.analysis.rollbackRequired = true;
    }
  }

  generateMarkdown() {
    const sections = [
      `# 🚨 Incident Report\n\n**Generated:** ${new Date().toISOString()}\n`,
      `## Summary\n- **Failed Step:** ${this.analysis.stepFailed}\n- **Severity:** ${this.analysis.severity.toUpperCase()}\n- **Confidence:** ${this.analysis.confidence.toUpperCase()}\n`,
      `## Root Cause Analysis\n${this.analysis.probableRootCause.map(cause => `- ${cause}`).join('\n')}\n`,
      `## Common Errors Detected\n${this.analysis.commonErrors.length > 0 ? this.analysis.commonErrors.map(e => `- ⚠️ ${e}`).join('\n') : '- No specific errors detected'}\n`,
      `## Suggested Actions\n${this.analysis.suggestedFixes.map(fix => `1. ${fix}`).join('\n')}\n`,
      `## Rollback Required\n${this.analysis.rollbackRequired ? '**YES** - Immediate rollback recommended' : '**NO** - No rollback needed'}\n`,
      `## Recommended Next Steps\n1. Review the fixes above\n2. Apply the fix and re-run the pipeline\n3. Monitor health check after deployment\n4. If issues persist, escalate to team\n`
    ];

    return sections.join('\n');
  }

  generateJson() {
    return {
      timestamp: new Date().toISOString(),
      analysis: this.analysis,
      recommendations: {
        immediate_actions: this.analysis.suggestedFixes,
        rollback_required: this.analysis.rollbackRequired,
        estimated_resolution_time: 'Low (< 5 min)' // In real world, could be estimated
      }
    };
  }
}

// Main execution
const logContent = fs.readFileSync(logPath, 'utf8');
const analyzer = new IncidentAnalyzer(logContent);
const analysis = analyzer.analyze();

// Generate markdown report
const markdownReport = analyzer.generateMarkdown();
fs.mkdirSync(path.dirname(outputPathMd), { recursive: true });
fs.writeFileSync(outputPathMd, markdownReport);

// Generate JSON report
const jsonReport = analyzer.generateJson();
fs.writeFileSync(outputPathJson, JSON.stringify(jsonReport, null, 2));

console.log(`✅ Incident report generated at: ${outputPathMd}`);
console.log(`✅ JSON report generated at: ${outputPathJson}`);
console.log(`\nAnalysis Summary:`);
console.log(`- Step Failed: ${analysis.stepFailed}`);
console.log(`- Severity: ${analysis.severity}`);
console.log(`- Confidence: ${analysis.confidence}`);
console.log(`- Rollback Required: ${analysis.rollbackRequired}`);
