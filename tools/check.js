/* levels.js 의 모든 레벨을 검증: 풀리는지, 앞으로만으로 풀리는지, 최단 걸음, 경로, 빛 자리별 그림자 */
(function () {
  const E = window.Engine;
  const lines = [];
  window.LEVELS.forEach((def, i) => {
    const level = E.parseLevel(def);
    const back = E.solve(level), fwd = E.solve(level, { allowBack: false });
    let nBack = 0;
    if (back) for (let k = 1; k < back.path.length; k++) if (back.path[k].t < back.path[k - 1].t) nBack++;
    lines.push(`[${i}] ${def.name}: solvable=${!!back} steps=${back ? back.steps : '-'} backSteps=${nBack} forwardOnly=${!!fwd}${fwd ? ' steps=' + fwd.steps : ''}`);
    if (back) lines.push('path: ' + back.path.map(p => `(${p.x},${p.y})@${p.t}`).join(' '));
    if (fwd) lines.push('fwdpath: ' + fwd.path.map(p => `(${p.x},${p.y})@${p.t}`).join(' '));
    for (let t = 0; t < E.PHASES.length; t++) lines.push(`t=${t} ${E.PHASES[t].name}\n` + E.asciiAt(level, t));
  });
  document.body.textContent = lines.join('\n');
})();
