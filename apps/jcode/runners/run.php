<?php
// jCode sandbox runner (PHP). Runs every case in ./cases.php against the
// function named there, capturing each case's echoes/var_dumps as the
// human's own output (tagged for the "My logs" view). Protocol lines are
// 0x1e-prefixed JSON records: one per case start, one summary at the end.
// Don't edit this file: it is copied fresh from the app on every publish.
declare(strict_types=1);
require __DIR__ . '/solution.php';
$spec = require __DIR__ . '/cases.php';
$RS = chr(0x1e);
$fn = $spec['fn'] ?? getenv('JCODE_FN') ?: null;
$cases = $spec['cases'] ?? $spec;
if (!$fn || !function_exists($fn)) {
  fwrite(STDOUT, "! solution.php defines no function" . ($fn ? " named $fn" : '') . "\n");
  exit(2);
}
$mine = function (string $text) use ($RS) {
  foreach (explode("\n", rtrim($text, "\n")) as $line) {
    if ($line === '' && $text === '') continue;
    fwrite(STDOUT, $RS . json_encode(['level' => 'log', 'text' => $line]) . "\n");
  }
};
$show = fn($v) => strlen($s = json_encode($v, JSON_UNESCAPED_SLASHES)) > 400 ? substr($s, 0, 400) . '…' : $s;
$passed = 0; $results = [];
foreach ($cases as $c) {
  fwrite(STDOUT, $RS . json_encode(['jcode' => true, 'type' => 'case', 'name' => $c['name']]) . "\n");
  $t0 = microtime(true); $ok = false; $error = null; $actual = null; $reason = null;
  ob_start();
  try {
    $actual = isset($c['call']) ? $c['call']($fn) : $fn(...($c['args'] ?? []));
    if (isset($c['check'])) { $r = $c['check']($actual); $ok = $r === true; if (is_string($r)) $reason = $r; }
    else $ok = json_encode($actual) === json_encode($c['expected'] ?? null);
  } catch (\Throwable $e) {
    $error = $e->getMessage();
    if (str_contains($error, 'jcode:')) $error = 'not implemented yet (the stub still throws)';
  }
  $mine(ob_get_clean() ?: '');
  $ms = (int) round((microtime(true) - $t0) * 1000);
  if ($ok) $passed++;
  $tail = $ok ? '' : ($error ? " — threw: $error" : ($reason ? " — $reason" : ' — expected ' . $show($c['expected'] ?? null) . ', got ' . $show($actual)));
  fwrite(STDOUT, ($ok ? '✓' : '✗') . " {$c['name']}$tail\n");
  $results[] = ['name' => $c['name'], 'pass' => $ok, 'ms' => $ms, 'expected' => isset($c['check']) ? null : $show($c['expected'] ?? null), 'actual' => $error ? null : $show($actual), 'error' => $error, 'reason' => $reason];
}
fwrite(STDOUT, "\n$passed/" . count($cases) . " cases passed\n");
fwrite(STDOUT, $RS . json_encode(['jcode' => true, 'type' => 'summary', 'passed' => $passed, 'total' => count($cases), 'cases' => $results]) . "\n");
exit($passed === count($cases) && count($cases) > 0 ? 0 : 1);
