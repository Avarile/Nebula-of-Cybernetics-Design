import { writeFileSync } from 'node:fs';
import type { CheckResult } from './types';

interface Operation {
  method: string;
  path: string;
  tag: string;
}

/**
 * Turns the recorded checks into a verdict plus a coverage number.
 *
 * Coverage is measured against the server's own OpenAPI document rather than a
 * hand-kept list, so an endpoint added tomorrow shows up as a gap here instead
 * of silently going untested.
 */
export class Report {
  constructor(
    private readonly results: CheckResult[],
    private readonly operations: Operation[],
  ) {}

  static async loadOperations(baseUrl: string): Promise<Operation[]> {
    const res = await fetch(`${baseUrl}/openapi.json`);
    if (!res.ok) {
      throw new Error(
        `Could not read ${baseUrl}/openapi.json (${res.status}). ` +
          'Set OPENAPI_ENABLED=true so the suite can measure coverage.',
      );
    }
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { tags?: string[] }>>;
    };
    const ops: Operation[] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method))
          continue;
        ops.push({
          method: method.toUpperCase(),
          path,
          tag: op.tags?.[0] ?? 'Untagged',
        });
      }
    }
    return ops;
  }

  private key(method: string, path: string): string {
    return `${method} ${path}`;
  }

  get executed(): CheckResult[] {
    return this.results.filter((r) => !r.skipped);
  }

  get failures(): CheckResult[] {
    return this.executed.filter((r) => !r.ok && !r.soft);
  }

  get softFailures(): CheckResult[] {
    return this.executed.filter((r) => !r.ok && r.soft);
  }

  get covered(): Set<string> {
    const hit = new Set<string>();
    for (const r of this.results) {
      if (r.skipped) continue;
      hit.add(this.key(r.method, r.template));
    }
    return hit;
  }

  get uncovered(): Operation[] {
    const hit = this.covered;
    return this.operations.filter((o) => !hit.has(this.key(o.method, o.path)));
  }

  /** Templates the suite exercised that the OpenAPI document does not declare. */
  get unknownTemplates(): string[] {
    const declared = new Set(
      this.operations.map((o) => this.key(o.method, o.path)),
    );
    return [...this.covered].filter((k) => !declared.has(k)).sort();
  }

  print(): void {
    const executed = this.executed;
    const passed = executed.filter((r) => r.ok).length;
    const skipped = this.results.filter((r) => r.skipped);

    const bySuite = new Map<string, CheckResult[]>();
    for (const r of executed) {
      const list = bySuite.get(r.suite) ?? [];
      list.push(r);
      bySuite.set(r.suite, list);
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log('RESULTS BY SUITE');
    console.log('='.repeat(78));
    for (const [suite, checks] of bySuite) {
      const bad = checks.filter((c) => !c.ok && !c.soft).length;
      const soft = checks.filter((c) => !c.ok && c.soft).length;
      const mark = bad > 0 ? 'FAIL' : soft > 0 ? 'WARN' : 'PASS';
      const softNote = soft > 0 ? `, ${soft} soft` : '';
      console.log(
        `  ${mark.padEnd(5)} ${suite.padEnd(34)} ${String(checks.length - bad - soft).padStart(3)}/${String(checks.length).padEnd(3)} passed${softNote}`,
      );
    }

    if (this.failures.length > 0) {
      console.log(`\n${'='.repeat(78)}`);
      console.log(`FAILURES (${this.failures.length})`);
      console.log('='.repeat(78));
      for (const f of this.failures) {
        console.log(`\n  [${f.suite}] ${f.name}`);
        console.log(`    ${f.method} ${f.url}  as:${f.actor}`);
        console.log(`    ${f.detail}`);
      }
    }

    if (this.softFailures.length > 0) {
      console.log(`\n${'='.repeat(78)}`);
      console.log(
        `SOFT FAILURES — external dependency, not a suite failure (${this.softFailures.length})`,
      );
      console.log('='.repeat(78));
      for (const f of this.softFailures) {
        console.log(`  [${f.suite}] ${f.method} ${f.template} — ${f.detail}`);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n${'='.repeat(78)}`);
      console.log(`SKIPPED (${skipped.length})`);
      console.log('='.repeat(78));
      for (const s of skipped) {
        console.log(`  ${s.method} ${s.template} — ${s.detail}`);
      }
    }

    this.printCoverage();

    const total = executed.length;
    console.log(`\n${'='.repeat(78)}`);
    console.log(
      `TOTAL  ${passed}/${total} checks passed` +
        `  |  ${this.failures.length} failed` +
        `  |  ${this.softFailures.length} soft` +
        `  |  ${skipped.length} skipped`,
    );
    console.log('='.repeat(78));
  }

  private printCoverage(): void {
    const uncovered = this.uncovered;
    const total = this.operations.length;
    const hit = total - uncovered.length;
    const pct = total === 0 ? 0 : Math.round((hit / total) * 1000) / 10;

    console.log(`\n${'='.repeat(78)}`);
    console.log(`ENDPOINT COVERAGE — ${hit}/${total} operations (${pct}%)`);
    console.log('='.repeat(78));

    const byTag = new Map<
      string,
      { hit: number; total: number; missing: string[] }
    >();
    const covered = this.covered;
    for (const op of this.operations) {
      const entry = byTag.get(op.tag) ?? { hit: 0, total: 0, missing: [] };
      entry.total += 1;
      if (covered.has(this.key(op.method, op.path))) entry.hit += 1;
      else entry.missing.push(`${op.method} ${op.path}`);
      byTag.set(op.tag, entry);
    }

    for (const [tag, entry] of [...byTag].sort()) {
      const bar = entry.hit === entry.total ? '████' : '░░░░';
      console.log(
        `  ${bar} ${tag.padEnd(16)} ${String(entry.hit).padStart(3)}/${String(entry.total).padEnd(3)}`,
      );
      for (const m of entry.missing) console.log(`         · ${m}`);
    }

    if (this.unknownTemplates.length > 0) {
      console.log('\n  Exercised but not declared in OpenAPI:');
      for (const t of this.unknownTemplates) console.log(`    · ${t}`);
    }
  }

  writeJson(path: string): void {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: {
        checks: this.executed.length,
        passed: this.executed.filter((r) => r.ok).length,
        failed: this.failures.length,
        soft: this.softFailures.length,
        skipped: this.results.filter((r) => r.skipped).length,
        operationsTotal: this.operations.length,
        operationsCovered: this.operations.length - this.uncovered.length,
      },
      uncovered: this.uncovered.map((o) => `${o.method} ${o.path}`),
      results: this.results,
    };
    writeFileSync(path, JSON.stringify(payload, null, 2));
    console.log(`\nMachine-readable report: ${path}`);
  }
}
