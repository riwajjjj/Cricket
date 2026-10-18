/* Crease — result chances for a Test: win, draw or lose.
   Plays the rest of the match out many times, an over at a time. Each over scores at the match's run
   rate and may cost a wicket, with partnerships getting shorter down the order; declarations and the
   follow-on use simple captain's rules. Rates start from typical Test figures (3.2 an over, a wicket
   every 57 balls) and move slowly towards this match's own figures as it goes on. Later innings lose
   wickets faster as the pitch wears, a side chasing an unlikely target blocks for the draw, and about
   a tenth of the time left is assumed lost to slow over rates, bad light and weather. No DOM here. */

const TAIL = [1.3, 1.3, 1.2, 1.15, 1.05, 1.0, 0.9, 0.8, 0.7, 0.55]; // relative length of each partnership
const WEAR = [1.1, 1.05, 0.92, 0.8]; // balls per wicket in the 1st to 4th innings, relative to the match rate
const TIME_USED = 0.9;                // share of the nominal overs left that actually get bowled
const BASE_RPB = 3.2 / 6, BASE_BPW = 57; // about 32 runs a wicket at 3.2 an over
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Small seeded generator, so the same match state always gives the same numbers (no flicker on re-render).
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* s = {
     inns: [{ bat, runs, wkts, balls, done }]  innings so far, in order (done: finished)
     next: { bat }                             who bats next, when no innings is in progress
     ballsLeft                                 balls left in the match
     wl: [w0, w1]                              wickets that end each team's innings (players − 1)
     fo                                        lead needed to enforce the follow-on
     declareNow                                treat the innings in progress as declared now
     sims                                      how many times to play it out
   } */
export function testOdds(s) {
    const R = s.inns.reduce((a, x) => a + x.runs, 0);
    const B = s.inns.reduce((a, x) => a + x.balls, 0);
    const W = s.inns.reduce((a, x) => a + x.wkts, 0);
    // How far to trust this match's own rates: runs settle quickly, wickets need more of them.
    const kR = B / (B + 1500), kW = W / (W + 30);
    const rpb = clamp((1 - kR) * BASE_RPB + kR * (B ? R / B : BASE_RPB), 0.3, 0.9);
    const bpw = clamp((1 - kW) * BASE_BPW + kW * (W ? B / W : BASE_BPW), 30, 120);
    const seed = s.inns.reduce((h, x) => Math.imul(h ^ (x.runs * 31 + x.wkts * 7 + x.balls), 2654435761), 0x9e3779b9 ^ s.ballsLeft ^ (s.declareNow ? 0x55 : 0));
    const rand = rng(seed);
    const sims = s.sims || 1500;
    const win = [0, 0];
    let draw = 0;
    for (let n = 0; n < sims; n++) {
        const r = playOut(s, rpb, bpw, rand);
        if (r === 0 || r === 1) win[r]++; else draw++;
    }
    return { win: [win[0] / sims, win[1] / sims], draw: draw / sims, rpo: rpb * 6, bpw };
}

// One way the rest of the match could go. Returns the winning team (0 or 1), or 2 for a draw or tie.
function playOut(s, rpb, bpw, rand) {
    const tot = [0, 0];
    s.inns.forEach(x => { if (x.done) tot[x.bat] += x.runs; });
    const order = s.inns.map(x => x.bat);
    const live = s.inns.find(x => !x.done);
    let T = Math.round(s.ballsLeft * TIME_USED), n, bat, runs, wk;
    if (live) { n = s.inns.length; bat = live.bat; runs = live.runs; wk = live.wkts; }
    else { n = s.inns.length + 1; bat = s.next.bat; runs = 0; wk = 0; order.push(bat); }
    let declareFirst = !!s.declareNow && !!live;
    for (;;) {
        const maxW = s.wl[bat], off = 10 - maxW;
        const target = n === 4 ? tot[1 - bat] - tot[bat] + 1 : Infinity;
        let ended = declareFirst, allOut = false;
        declareFirst = false;
        const tempo = 0.8 + 0.4 * rand(); // some innings simply go faster than others
        while (!ended) {
            if (runs >= target) return bat;
            if (T <= 0) return 2; // out of time
            const take = Math.min(6, T);
            // A chase that has become unlikely turns into blocking for the draw (fewer runs, wickets harder to take):
            // more than 4.5 an over needed, more than 3 with half the side out, or 30+ needed with two wickets left.
            const rate = (target - runs) / (T / 6);
            const block = n === 4 && (rate > 4.5 || (rate > 3 && wk >= maxW / 2) || (wk >= maxW - 2 && target - runs > 30));
            T -= take;
            runs += take * rpb * tempo * (block ? 0.55 : 1);
            if (runs >= target) return bat;
            if (rand() < take / (bpw * WEAR[n - 1] * (block ? 1.45 : 1) * TAIL[clamp(wk + off, 0, 9)])) {
                wk++;
                if (wk >= maxW) { ended = true; allOut = true; }
            }
            if (!ended && n < 4) {
                const lead = tot[bat] + runs - tot[1 - bat];
                if (n === 1 && runs >= 550) ended = true;                     // big first-innings total: declare
                if (n === 2 && runs >= 500 && lead >= 150) ended = true;      // big lead in reply: declare
                // Third innings: declare once the lead is safe for the time left (4 an over, at most 400), leaving 30+ overs to bowl.
                if (n === 3 && lead > 0 && T >= 180 && lead >= Math.min(400, 4 * T / 6)) ended = true;
            }
        }
        tot[bat] += runs;
        if (n === 4) return allOut ? (Math.floor(runs) === target - 1 ? 2 : 1 - bat) : 2;
        if (n === 1) bat = 1 - bat;
        else if (n === 2) bat = tot[order[0]] - tot[order[1]] >= s.fo ? order[1] : order[0]; // follow-on enforced when allowed
        else {
            bat = 1 - bat;
            if (tot[1 - bat] < tot[bat]) return bat; // still behind after both innings: an innings defeat
        }
        n++; order.push(bat); runs = 0; wk = 0;
    }
}