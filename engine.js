/* engine.js — 그늘길 규칙 엔진
   맵 파싱, 빛/그림자 모델, 이동 규칙, BFS 솔버.
   브라우저에서는 전역 `Engine`, Node/도구에서는 module.exports 로 노출. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 격자 좌표: x 는 동쪽(+), y 는 남쪽(+)
  const DIRS = { N: { dx: 0, dy: -1 }, E: { dx: 1, dy: 0 }, S: { dx: 0, dy: 1 }, W: { dx: -1, dy: 0 } };
  const DIR_ORDER = ['N', 'E', 'S', 'W'];

  function turn(facing, delta) {
    return DIR_ORDER[(DIR_ORDER.indexOf(facing) + delta + 4) % 4];
  }

  /* 빛의 네 자리. 한 걸음마다 시계 방향으로 한 자리씩 돈다: 동쪽 해(아침) → 남쪽(정오) → 서쪽(저녁) → 북쪽 달(밤) → 다시 아침.
     sx, sy 는 빛이 있는 방향. 그림자는 빛 반대쪽 면에서 격자 축을 따라 건물 높이만큼 일직선으로 뻗는다. */
  const PHASES = [
    { key: 'morning', name: '아침', sx: 1, sy: 0, moon: false },
    { key: 'noon',    name: '정오', sx: 0, sy: 1, moon: false },
    { key: 'evening', name: '저녁', sx: -1, sy: 0, moon: false },
    { key: 'night',   name: '밤',   sx: 0, sy: -1, moon: true },
  ];
  const N = PHASES.length;
  const phaseIndex = (t) => ((t % N) + N) % N;

  /* 레벨 정의 → 런타임 레벨
     map 문자: '.' 바닥, '#' 또는 ' ' 없음(구멍), '1'~'9' 건물(높이), 'S' 시작 바닥, 'G' 목표 바닥
     startTime: 시작 시각 (0 아침, 1 정오, 2 저녁, 3 밤). 시간은 순환하며 끝이 없다. */
  function parseLevel(def) {
    const rows = def.map;
    const H = rows.length;
    const W = Math.max.apply(null, rows.map(r => r.length));
    const tiles = [];
    const buildings = [];
    let start = null, goal = null;
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const c = rows[y][x] || '#';
        if (c === '#' || c === ' ') row.push({ type: 'void' });
        else if (c >= '1' && c <= '9') { const h = +c; row.push({ type: 'building', h }); buildings.push({ x, y, h }); }
        else {
          row.push({ type: 'floor' });
          if (c === 'S') start = { x, y };
          if (c === 'G') goal = { x, y };
        }
      }
      tiles.push(row);
    }
    if (!start || !goal) throw new Error('level needs S and G: ' + def.name);
    return {
      name: def.name || '', hint: def.hint || '',
      W, H, tiles, buildings, goal,
      start: { x: start.x, y: start.y, facing: def.facing || 'E', t: def.startTime || 0 },
      _shadowCache: {},
    };
  }

  // 시각 t 의 빛. arm: 그림자가 뻗는 방향(빛 반대쪽), index: 자리 번호
  function sunAt(level, t) {
    const i = phaseIndex(t);
    const p = PHASES[i];
    return { phase: p, key: p.key, name: p.name, moon: p.moon, sx: p.sx, sy: p.sy, arm: { dx: -p.sx, dy: -p.sy }, index: i };
  }

  // 건물 b 의 그림자 사각형(격자 좌표). 그리기용
  function shadowRect(b, sun) {
    const a = sun.arm;
    const x0 = b.x + Math.min(0, a.dx * b.h), x1 = b.x + 1 + Math.max(0, a.dx * b.h);
    const y0 = b.y + Math.min(0, a.dy * b.h), y1 = b.y + 1 + Math.max(0, a.dy * b.h);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  // 시각 t 에 그림자 진 바닥 타일 2D 불리언 배열 (자리별 캐시)
  function shadowMap(level, t) {
    const i = phaseIndex(t);
    const cache = level._shadowCache;
    if (cache[i]) return cache[i];
    const sun = sunAt(level, t);
    const map = [];
    for (let y = 0; y < level.H; y++) map.push(new Array(level.W).fill(false));
    for (const b of level.buildings) {
      for (let k = 1; k <= b.h; k++) {
        const x = b.x + sun.arm.dx * k, y = b.y + sun.arm.dy * k;
        if (x < 0 || y < 0 || x >= level.W || y >= level.H) break;
        if (level.tiles[y][x].type === 'floor') map[y][x] = true;
      }
    }
    cache[i] = map;
    return map;
  }

  function isFloor(level, x, y) {
    return x >= 0 && y >= 0 && x < level.W && y < level.H && level.tiles[y][x].type === 'floor';
  }

  function canStand(level, x, y, t) {
    return isFloor(level, x, y) && shadowMap(level, t)[y][x];
  }

  // (x,y) 로 시각 t 에 갈 수 없는 이유. 갈 수 있으면 null
  function stepProblem(level, x, y, t) {
    if (!isFloor(level, x, y)) {
      const tile = level.tiles[y] && level.tiles[y][x];
      return tile && tile.type === 'building' ? 'building' : 'void';
    }
    if (!shadowMap(level, t)[y][x]) return 'light';
    return null;
  }

  /* 행동: 'L'/'R' 제자리 회전(시간 유지), 'F' 앞으로 한 칸(t+1), 'B' 뒤로 한 칸(t-1) */
  function applyAction(level, st, action) {
    if (action === 'L' || action === 'R') {
      return { ok: true, state: { x: st.x, y: st.y, facing: turn(st.facing, action === 'L' ? -1 : 1), t: st.t } };
    }
    const d = DIRS[st.facing];
    const sign = action === 'F' ? 1 : -1;
    const nx = st.x + d.dx * sign, ny = st.y + d.dy * sign, nt = st.t + sign;
    const problem = stepProblem(level, nx, ny, nt);
    // 건물/구멍은 막히고, 밝은 땅은 밟을 수는 있지만 치명적(fatal)
    if (problem && problem !== 'light') return { ok: false, problem, target: { x: nx, y: ny, t: nt } };
    return { ok: true, state: { x: nx, y: ny, facing: st.facing, t: nt }, step: true, fatal: problem === 'light' };
  }

  function isGoal(level, st) { return st.x === level.goal.x && st.y === level.goal.y; }

  /* (x, y, 빛 자리) 공간 BFS. 회전은 공짜라 방향은 도달성에 영향 없음.
     opts.allowBack=false 면 뒤로 걷기 금지. 결과 { steps, path } 또는 null */
  function solve(level, opts) {
    opts = opts || {};
    const allowBack = opts.allowBack !== false;
    const key = (x, y, t) => (phaseIndex(t) * level.H + y) * level.W + x;
    const s0 = level.start;
    if (!canStand(level, s0.x, s0.y, s0.t)) return null;
    const prev = new Map();
    const q = [[s0.x, s0.y, s0.t]];
    prev.set(key(s0.x, s0.y, s0.t), null);
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const x = cur[0], y = cur[1], t = cur[2];
      if (x === level.goal.x && y === level.goal.y) {
        const path = [];
        let node = cur;
        while (node) { path.push({ x: node[0], y: node[1], t: node[2] }); node = prev.get(key(node[0], node[1], node[2])); }
        path.reverse();
        return { steps: path.length - 1, path };
      }
      for (const dir of DIR_ORDER) {
        const d = DIRS[dir];
        const signs = allowBack ? [1, -1] : [1];
        for (const sign of signs) {
          const nx = x + d.dx * sign, ny = y + d.dy * sign, nt = t + sign;
          if (!canStand(level, nx, ny, nt)) continue;
          const k = key(nx, ny, nt);
          if (prev.has(k)) continue;
          prev.set(k, cur);
          q.push([nx, ny, nt]);
        }
      }
    }
    return null;
  }

  // 시각 t 의 그림자 맵을 문자로 (디버그용): 숫자 건물, ' '없음, '▓'그림자, '·'밝음, G/g 목표(그림자/밝음), S 시작
  function asciiAt(level, t) {
    const sm = shadowMap(level, t);
    const out = [];
    for (let y = 0; y < level.H; y++) {
      let line = '';
      for (let x = 0; x < level.W; x++) {
        const tile = level.tiles[y][x];
        let c = tile.type === 'void' ? ' ' : tile.type === 'building' ? String(tile.h) : (sm[y][x] ? '▓' : '·');
        if (x === level.goal.x && y === level.goal.y && tile.type === 'floor') c = sm[y][x] ? 'G' : 'g';
        if (x === level.start.x && y === level.start.y && phaseIndex(t) === phaseIndex(level.start.t)) c = 'S';
        line += c;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  return { DIRS, DIR_ORDER, PHASES, phaseIndex, turn, parseLevel, sunAt, shadowRect, shadowMap, isFloor, canStand, stepProblem, applyAction, isGoal, solve, asciiAt };
});
