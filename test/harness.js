// Tiny zero-dependency test harness.
export const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}
export async function runTests() {
  let passed = 0;
  let failed = 0;
  const failures = [];
  for (const t of tests) {
    const t0 = Date.now();
    try {
      const info = await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}${info ? `  — ${info}` : ''} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      failures.push({ name: t.name, error: e });
      console.log(`  ✗ ${t.name}\n      ${(e && e.stack) || e}`);
    }
  }
  return { passed, failed, failures, total: tests.length };
}
