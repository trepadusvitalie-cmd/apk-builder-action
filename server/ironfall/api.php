<?php
// Ironfall 2200 — tiny room / relay server (no database needed).
// Up to four phones (one host + three guests) meet here with a room code, exchange WebRTC
// handshake messages, and can fall back to relaying game messages through this script.
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

const DIR = __DIR__ . '/data';
const TTL = 3 * 3600;         // rooms expire after 3 hours without activity
const KEEP = 400;             // messages kept per queue
const MAX_BODY = 1048576;     // 1 MB per request (first full world update can be large)
const MAX_GUESTS = 3;         // host + 3 guests = 4 players

function out($a, $code = 200) { http_response_code($code); echo json_encode($a); exit; }
function roomFile($r) { return DIR . '/r_' . $r . '.json'; }
function cleanCode($r) { $r = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$r)); return strlen($r) === 5 ? $r : ''; }
function fixRoom(&$room) { // fills in anything a room created by an older version of this script lacks
  foreach (['h', 'c1', 'c2', 'c3'] as $k) { if (!isset($room['q'][$k])) $room['q'][$k] = []; if (!isset($room['seq'][$k])) $room['seq'][$k] = 0; }
  if (!isset($room['guests'])) $room['guests'] = !empty($room['joined']) ? [1] : [];
  if (!isset($room['started'])) $room['started'] = false;
}
function withRoom($r, $fn) {
  $f = roomFile($r); if (!is_file($f)) out(['err' => 'nu există camera'], 404);
  $h = fopen($f, 'c+'); flock($h, LOCK_EX);
  $room = json_decode(stream_get_contents($h), true) ?: null;
  if (!$room) { flock($h, LOCK_UN); fclose($h); out(['err' => 'cameră coruptă'], 500); }
  fixRoom($room);
  $res = $fn($room);
  $room['t'] = time();
  ftruncate($h, 0); rewind($h); fwrite($h, json_encode($room)); fflush($h);
  flock($h, LOCK_UN); fclose($h);
  return $res;
}
function gc() {
  if (mt_rand(0, 30) !== 0) return;
  foreach (glob(DIR . '/r_*.json') ?: [] as $f) if (filemtime($f) < time() - TTL) @unlink($f); // rooms and their state files
}
function push(&$room, $k, $m) {
  $room['seq'][$k]++; $room['q'][$k][] = [$room['seq'][$k], $m];
  if (count($room['q'][$k]) > KEEP) $room['q'][$k] = array_slice($room['q'][$k], -KEEP);
}
// host messages go to every guest, or only to the guests listed in "_to"; guest messages go to the host, tagged with "_from"
function deliver(&$room, $me, $msgs) {
  foreach ($msgs as $m) {
    if (!is_array($m)) continue;
    if ($me === 'h') {
      $to = isset($m['_to']) && is_array($m['_to']) ? array_map('intval', $m['_to']) : $room['guests']; unset($m['_to']);
      foreach ($to as $g) if (in_array($g, $room['guests'], true)) push($room, 'c' . $g, $m);
    } else { $m['_from'] = (int)substr($me, 1); push($room, 'h', $m); }
  }
}
function take(&$room, $me, $after) {
  $list = []; foreach ($room['q'][$me] as $e) if ($e[0] > $after) $list[] = $e;
  $room['q'][$me] = $list;  // delivered messages before $after can be dropped
  return $list;
}

if (!is_dir(DIR)) @mkdir(DIR, 0775, true);
$a = $_GET['a'] ?? '';
$meRaw = (string)($_GET['me'] ?? '');
$me = $meRaw === 'h' ? 'h' : (preg_match('/^c([1-3])$/', $meRaw, $mm) ? 'c' . $mm[1] : 'c1');   // "c" from older apps = guest 1

if ($a === 'create') {
  gc();
  $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for ($i = 0; $i < 20; $i++) { $r = ''; for ($k = 0; $k < 5; $k++) $r .= $abc[random_int(0, strlen($abc) - 1)]; if (!is_file(roomFile($r))) break; }
  $room = ['t' => time(), 'mode' => substr(preg_replace('/[^a-z0-9]/', '', $_GET['mode'] ?? 'coop'), 0, 8), 'map' => (int)($_GET['map'] ?? 0), 'joined' => false, 'guests' => [], 'started' => false,
           'q' => ['h' => [], 'c1' => [], 'c2' => [], 'c3' => []], 'seq' => ['h' => 0, 'c1' => 0, 'c2' => 0, 'c3' => 0]];
  file_put_contents(roomFile($r), json_encode($room), LOCK_EX);
  out(['room' => $r]);
}

$r = cleanCode($_GET['room'] ?? ''); if (!$r) out(['err' => 'cod greșit'], 400);

if ($a === 'join') {
  $res = withRoom($r, function (&$room) {
    if ($room['started']) return ['err' => 'partida a început deja'];
    if (count($room['guests']) >= MAX_GUESTS) return ['err' => 'camera e plină (4 jucători)'];
    for ($s = 1; $s <= MAX_GUESTS; $s++) if (!in_array($s, $room['guests'], true)) break;
    $room['guests'][] = $s; sort($room['guests']); $room['joined'] = true;
    $room['q']['c' . $s] = []; // a fresh slot starts with an empty queue
    return ['ok' => true, 'mode' => $room['mode'], 'map' => $room['map'], 'slot' => $s]; });
  out($res, isset($res['err']) ? 409 : 200);
}

if ($a === 'send') {   // POST body: JSON array of messages
  $body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
  if (strlen($body) > MAX_BODY) out(['err' => 'prea mare'], 413);
  $msgs = json_decode($body, true); if (!is_array($msgs)) out(['err' => 'json'], 400);
  withRoom($r, function (&$room) use ($msgs, $me) { deliver($room, $me, $msgs); });
  out(['ok' => true]);
}

if ($a === 'poll') {   // returns messages addressed to me after sequence number
  $after = (int)($_GET['after'] ?? 0);
  $res = withRoom($r, function (&$room) use ($me, $after) { return ['joined' => $room['joined'], 'guests' => $room['guests'], 'msgs' => take($room, $me, $after)]; });
  out($res);
}

if ($a === 'sync') {   // POST {to:[...], snap?}: deliver my messages, store (host) / fetch (guest) the latest state, return my messages
  $body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
  if (strlen($body) > MAX_BODY) out(['err' => 'prea mare'], 413);
  $in = json_decode($body ?: '{}', true); if (!is_array($in)) $in = [];
  $to = isset($in['to']) && is_array($in['to']) ? $in['to'] : [];
  $after = (int)($_GET['after'] ?? 0); $have = (int)($_GET['have'] ?? 0); $st = !empty($_GET['st']);
  $snapIn = ($me === 'h' && isset($in['snap'])) ? json_encode($in['snap']) : null;
  $sf = DIR . '/r_' . $r . '.snap.json';
  $res = withRoom($r, function (&$room) use ($to, $me, $after, $snapIn, $sf, $st) {
    deliver($room, $me, $to);
    if ($me === 'h' && $st) $room['started'] = true;
    $list = take($room, $me, $after);
    if (!isset($room['snapSeq'])) $room['snapSeq'] = 0;
    if ($snapIn !== null) { $room['snapSeq']++; file_put_contents($sf, $snapIn, LOCK_EX); }
    return ['joined' => $room['joined'], 'guests' => $room['guests'], 'msgs' => $list, 'snapSeq' => $room['snapSeq']];
  });
  if ($me !== 'h' && $res['snapSeq'] > $have && is_file($sf)) { $snap = json_decode(file_get_contents($sf), true); if ($snap !== null) $res['snap'] = $snap; }
  out($res);
}

if ($a === 'leave') {
  if ($me === 'h') { @unlink(roomFile($r)); @unlink(DIR . '/r_' . $r . '.snap.json'); out(['ok' => true]); }
  if (is_file(roomFile($r))) withRoom($r, function (&$room) use ($me) { // a guest leaving the lobby frees its slot
    if (!$room['started']) { $s = (int)substr($me, 1); $room['guests'] = array_values(array_filter($room['guests'], function ($g) use ($s) { return $g !== $s; })); $room['joined'] = count($room['guests']) > 0; } });
  out(['ok' => true]);
}
out(['err' => 'acțiune necunoscută'], 400);
