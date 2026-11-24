<?php
// Ironfall 2200 — tiny room / relay server (no database needed).
// Two phones meet here with a room code, exchange WebRTC handshake messages,
// and can fall back to relaying game messages through this script.
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

const DIR = __DIR__ . '/data';
const TTL = 3 * 3600;         // rooms expire after 3 hours without activity
const KEEP = 400;             // messages kept per direction
const MAX_BODY = 1048576;     // 1 MB per request (first full world update can be large)

function out($a, $code = 200) { http_response_code($code); echo json_encode($a); exit; }
function roomFile($r) { return DIR . '/r_' . $r . '.json'; }
function cleanCode($r) { $r = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$r)); return strlen($r) === 5 ? $r : ''; }
function withRoom($r, $fn) {
  $f = roomFile($r); if (!is_file($f)) out(['err' => 'nu există camera'], 404);
  $h = fopen($f, 'c+'); flock($h, LOCK_EX);
  $room = json_decode(stream_get_contents($h), true) ?: null;
  if (!$room) { flock($h, LOCK_UN); fclose($h); out(['err' => 'cameră coruptă'], 500); }
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

if (!is_dir(DIR)) @mkdir(DIR, 0775, true);
$a = $_GET['a'] ?? '';
$me = ($_GET['me'] ?? '') === 'h' ? 'h' : 'c';     // h = host, c = client
$other = $me === 'h' ? 'c' : 'h';

if ($a === 'create') {
  gc();
  $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for ($i = 0; $i < 20; $i++) { $r = ''; for ($k = 0; $k < 5; $k++) $r .= $abc[random_int(0, strlen($abc) - 1)]; if (!is_file(roomFile($r))) break; }
  $room = ['t' => time(), 'mode' => substr(preg_replace('/[^a-z0-9]/', '', $_GET['mode'] ?? 'coop'), 0, 8), 'map' => (int)($_GET['map'] ?? 0), 'joined' => false,
           'q' => ['h' => [], 'c' => []], 'seq' => ['h' => 0, 'c' => 0]];
  file_put_contents(roomFile($r), json_encode($room), LOCK_EX);
  out(['room' => $r]);
}

$r = cleanCode($_GET['room'] ?? ''); if (!$r) out(['err' => 'cod greșit'], 400);

if ($a === 'join') {
  $res = withRoom($r, function (&$room) { if ($room['joined']) return ['err' => 'camera e plină'];
    $room['joined'] = true; return ['ok' => true, 'mode' => $room['mode'], 'map' => $room['map']]; });
  out($res, isset($res['err']) ? 409 : 200);
}

if ($a === 'send') {   // POST body: JSON array of messages for the other side
  $body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
  if (strlen($body) > MAX_BODY) out(['err' => 'prea mare'], 413);
  $msgs = json_decode($body, true); if (!is_array($msgs)) out(['err' => 'json'], 400);
  $n = withRoom($r, function (&$room) use ($msgs, $other) {
    foreach ($msgs as $m) { $room['seq'][$other]++; $room['q'][$other][] = [$room['seq'][$other], $m]; }
    if (count($room['q'][$other]) > KEEP) $room['q'][$other] = array_slice($room['q'][$other], -KEEP);
    return $room['seq'][$other]; });
  out(['ok' => true, 'seq' => $n]);
}

if ($a === 'poll') {   // returns messages addressed to me after sequence number
  $after = (int)($_GET['after'] ?? 0);
  $res = withRoom($r, function (&$room) use ($me, $after) {
    $list = []; foreach ($room['q'][$me] as $e) if ($e[0] > $after) $list[] = $e;
    $room['q'][$me] = $list;  // delivered messages before $after can be dropped
    return ['joined' => $room['joined'], 'msgs' => $list]; });
  out($res);
}

if ($a === 'sync') {   // POST {to:[...], snap?}: deliver my messages, store (host) / fetch (guest) the latest state, return my messages
  $body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
  if (strlen($body) > MAX_BODY) out(['err' => 'prea mare'], 413);
  $in = json_decode($body ?: '{}', true); if (!is_array($in)) $in = [];
  $to = isset($in['to']) && is_array($in['to']) ? $in['to'] : [];
  $after = (int)($_GET['after'] ?? 0); $have = (int)($_GET['have'] ?? 0);
  $snapIn = ($me === 'h' && isset($in['snap'])) ? json_encode($in['snap']) : null;
  $sf = DIR . '/r_' . $r . '.snap.json';
  $res = withRoom($r, function (&$room) use ($to, $me, $other, $after, $snapIn, $sf) {
    foreach ($to as $m) { $room['seq'][$other]++; $room['q'][$other][] = [$room['seq'][$other], $m]; }
    if (count($room['q'][$other]) > KEEP) $room['q'][$other] = array_slice($room['q'][$other], -KEEP);
    $list = []; foreach ($room['q'][$me] as $e) if ($e[0] > $after) $list[] = $e;
    $room['q'][$me] = $list;
    if (!isset($room['snapSeq'])) $room['snapSeq'] = 0;
    if ($snapIn !== null) { $room['snapSeq']++; file_put_contents($sf, $snapIn, LOCK_EX); }
    return ['joined' => $room['joined'], 'msgs' => $list, 'snapSeq' => $room['snapSeq']];
  });
  if ($me === 'c' && $res['snapSeq'] > $have && is_file($sf)) { $snap = json_decode(file_get_contents($sf), true); if ($snap !== null) $res['snap'] = $snap; }
  out($res);
}

if ($a === 'leave') { @unlink(roomFile($r)); @unlink(DIR . '/r_' . $r . '.snap.json'); out(['ok' => true]); }
out(['err' => 'acțiune necunoscută'], 400);
