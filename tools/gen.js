/* 레벨 생성기 (헤드리스 Chrome 에서 gen.html 로 실행)
   무작위 맵을 만들고 조건에 맞는 것만 출력. 쿼리:
   seed tries w h min max  : 시드, 시도 수, 맵 크기, 최단 걸음 범위
   back maxback            : 최단 경로의 뒤로 걷기 횟수 범위
   fwdonly=1               : 앞으로만 걸어도 풀리는 맵만 (0 이면 앞으로만으로는 못 푸는 맵만, anyfwd=1 이면 상관없음)
   maxturns                : fwdonly 일 때 앞으로만 경로의 방향 전환 수 상한
   nbmin nbmax voids top   : 건물 수 범위, 구멍 수 상한, 출력 개수 */
(function () {
  const E = window.Engine;
  const p = new URLSearchParams(location.search);
  const num = (k, d) => (p.has(k) ? +p.get(k) : d);
  const SEED = num('seed', 1), TRIES = num('tries', 20000);
  const MIN_STEPS = num('min', 5), MAX_STEPS = num('max', 12);
  const MIN_BACK = num('back', 0), MAX_BACK = num('maxback', 99);
  const W = num('w', 7), H = num('h', 6), TOP = num('top', 12);
  const NB_MIN = num('nbmin', 3), NB_MAX = num('nbmax', 6), VOIDS = num('voids', 2);
  const FWDONLY = num('fwdonly', 0), ANYFWD = num('anyfwd', 0), MAX_TURNS = num('maxturns', 99);
  const NPH = E.PHASES.length;

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(SEED);
  const ri = (n) => Math.floor(rnd() * n);

  function randomDef() {
    const grid = [];
    for (let y = 0; y < H; y++) grid.push(Array(W).fill('.'));
    const nb = NB_MIN + ri(NB_MAX - NB_MIN + 1);
    for (let i = 0; i < nb; i++) grid[ri(H)][ri(W)] = String(1 + ri(3));
    const nv = ri(VOIDS + 1);
    for (let i = 0; i < nv; i++) grid[ri(H)][ri(W)] = '#';
    const floors = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === '.') floors.push([x, y]);
    if (floors.length < 8) return null;
    const s = floors[ri(floors.length)];
    const g = floors[ri(floors.length)];
    if (Math.abs(s[0] - g[0]) + Math.abs(s[1] - g[1]) < 3) return null;
    grid[s[1]][s[0]] = 'S'; grid[g[1]][g[0]] = 'G';
    return { name: 'gen', map: grid.map(r => r.join('')), startTime: ri(NPH), facing: 'E' };
  }

  function turns(path) {
    let n = 0, last = null;
    for (let k = 1; k < path.length; k++) {
      const d = (path[k].x - path[k - 1].x) + ',' + (path[k].y - path[k - 1].y);
      if (last !== null && d !== last) n++;
      last = d;
    }
    return n;
  }
  // 첫 걸음이 자연스럽도록 시작 방향 제안: 첫 이동이 앞걸음이면 이동 방향, 뒷걸음이면 그 반대
  function suggestFacing(path) {
    const a = path[0], b = path[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    let dir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
    if (b.t < a.t) dir = E.turn(dir, 2);
    return dir;
  }

  const results = [];
  let nDefs = 0, nSolv = 0, nFwd = 0;
  for (let i = 0; i < TRIES; i++) {
    const def = randomDef();
    if (!def) continue;
    nDefs++;
    let level;
    try { level = E.parseLevel(def); } catch (e) { continue; }
    const back = E.solve(level);
    if (!back) continue;
    nSolv++;
    const fwd = E.solve(level, { allowBack: false });
    if (fwd) nFwd++;
    let main = back;
    if (FWDONLY) { if (!fwd || turns(fwd.path) > MAX_TURNS) continue; main = fwd; }
    else if (!ANYFWD && fwd) continue;
    if (main.steps < MIN_STEPS || main.steps > MAX_STEPS) continue;
    let nBack = 0;
    for (let k = 1; k < main.path.length; k++) if (main.path[k].t < main.path[k - 1].t) nBack++;
    if (nBack < MIN_BACK || nBack > MAX_BACK) continue;
    const voids = def.map.join('').split('#').length - 1;
    results.push({ def, steps: main.steps, nBack, voids, turns: turns(main.path), path: main.path, level });
  }
  results.sort((a, b) => (a.voids - b.voids) || (a.turns - b.turns) || (a.steps - b.steps));

  const lines = [];
  lines.push(`seed=${SEED} tries=${TRIES} defs=${nDefs} solvable=${nSolv} fwdSolvable=${nFwd} found=${results.length}`);
  results.slice(0, TOP).forEach((r, idx) => {
    lines.push(`--- #${idx} steps=${r.steps} back=${r.nBack} turns=${r.turns} voids=${r.voids} startTime=${r.def.startTime} facing=${suggestFacing(r.path)}`);
    lines.push(JSON.stringify(r.def.map));
    lines.push('path: ' + r.path.map(p => `(${p.x},${p.y})@${p.t}`).join(' '));
    lines.push(E.asciiAt(r.level, r.def.startTime));
  });
  document.body.textContent = lines.join('\n');
})();
