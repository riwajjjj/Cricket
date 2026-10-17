/* Runs the same cases as `npm test`, in the browser. Open tests/index.html through the same
   local server you use for the app. */
import cases from './cases.js';

const out = document.getElementById('out');
const groups = new Map();
let pass = 0, fail = 0;
for (const c of cases) {
  let list = groups.get(c.group);
  if (!list) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h2></h2><ul></ul>';
    sec.querySelector('h2').textContent = c.group;
    out.append(sec);
    list = sec.querySelector('ul');
    groups.set(c.group, list);
  }
  const li = document.createElement('li');
  li.textContent = c.name;
  try { c.run(); li.className = 'pass'; pass++; }
  catch (e) {
    li.className = 'fail'; fail++;
    const err = document.createElement('span'); err.className = 'err'; err.textContent = e.message; li.append(err);
  }
  list.append(li);
}
document.getElementById('sum').innerHTML = fail
  ? `<b class="bad">${fail} failed</b> · ${pass} passed · ${cases.length} checks`
  : `<b class="ok">All ${pass} passed</b> · ${cases.length} checks`;
document.title = fail ? `✕ ${fail} failed · Crease tests` : '✓ Crease tests';
