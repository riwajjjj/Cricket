/* Crease — the ICC Men's Cricket World Cup 2023 (India), as a ready-made tournament.
   Ten teams play each other once (45 matches, 50 overs a side). 2 points for a win, 1 for a no result; a tied
   match goes to a super over. Teams level on points are separated by wins, then net run rate. The top four
   play the semi-finals (1st v 4th in Mumbai, 2nd v 3rd in Kolkata) and the winners meet in the final in
   Ahmedabad. Pakistan were to play any semi-final in Kolkata, and India theirs in Mumbai unless they met Pakistan. */
import { uid } from '../utils.js';

const G = {
    AHM: 'Narendra Modi Stadium, Ahmedabad', HYD: 'Rajiv Gandhi International Stadium, Hyderabad', DHA: 'HPCA Stadium, Dharamsala',
    DEL: 'Arun Jaitley Stadium, Delhi', CHE: 'MA Chidambaram Stadium, Chennai', LKO: 'Ekana Cricket Stadium, Lucknow',
    PUN: 'MCA Stadium, Pune', BEN: 'M Chinnaswamy Stadium, Bengaluru', MUM: 'Wankhede Stadium, Mumbai', KOL: 'Eden Gardens, Kolkata',
};
const IND = 'India', PAK = 'Pakistan', AUS = 'Australia', ENG = 'England', NZ = 'New Zealand', SA = 'South Africa',
    BAN = 'Bangladesh', AFG = 'Afghanistan', SL = 'Sri Lanka', NED = 'Netherlands';
// The 45 league matches in match-number order: date, the side named first, the other side, ground.
const LEAGUE = [
    ['2023-10-05', ENG, NZ, 'AHM'], ['2023-10-06', PAK, NED, 'HYD'], ['2023-10-07', BAN, AFG, 'DHA'], ['2023-10-07', SA, SL, 'DEL'],
    ['2023-10-08', IND, AUS, 'CHE'], ['2023-10-09', NZ, NED, 'HYD'], ['2023-10-10', ENG, BAN, 'DHA'], ['2023-10-10', PAK, SL, 'HYD'],
    ['2023-10-11', IND, AFG, 'DEL'], ['2023-10-12', AUS, SA, 'LKO'], ['2023-10-13', NZ, BAN, 'CHE'], ['2023-10-14', IND, PAK, 'AHM'],
    ['2023-10-15', ENG, AFG, 'DEL'], ['2023-10-16', AUS, SL, 'LKO'], ['2023-10-17', SA, NED, 'DHA'], ['2023-10-18', NZ, AFG, 'CHE'],
    ['2023-10-19', IND, BAN, 'PUN'], ['2023-10-20', AUS, PAK, 'BEN'], ['2023-10-21', NED, SL, 'LKO'], ['2023-10-21', ENG, SA, 'MUM'],
    ['2023-10-22', IND, NZ, 'DHA'], ['2023-10-23', PAK, AFG, 'CHE'], ['2023-10-24', SA, BAN, 'MUM'], ['2023-10-25', AUS, NED, 'DEL'],
    ['2023-10-26', ENG, SL, 'BEN'], ['2023-10-27', PAK, SA, 'CHE'], ['2023-10-28', AUS, NZ, 'DHA'], ['2023-10-28', NED, BAN, 'KOL'],
    ['2023-10-29', IND, ENG, 'LKO'], ['2023-10-30', AFG, SL, 'PUN'], ['2023-10-31', PAK, BAN, 'KOL'], ['2023-11-01', NZ, SA, 'PUN'],
    ['2023-11-02', IND, SL, 'MUM'], ['2023-11-03', NED, AFG, 'LKO'], ['2023-11-04', NZ, PAK, 'BEN'], ['2023-11-04', ENG, AUS, 'AHM'],
    ['2023-11-05', IND, SA, 'KOL'], ['2023-11-06', BAN, SL, 'DEL'], ['2023-11-07', AUS, AFG, 'MUM'], ['2023-11-08', ENG, NED, 'PUN'],
    ['2023-11-09', NZ, SL, 'BEN'], ['2023-11-10', SA, AFG, 'AHM'], ['2023-11-11', AUS, BAN, 'PUN'], ['2023-11-11', ENG, PAK, 'KOL'],
    ['2023-11-12', IND, NED, 'BEN'],
];

export function cwc23Template() {
    const fx = (extra) => ({ id: uid(), matchId: null, manual: null, nr: false, ...extra });
    return {
        id: uid(), created: Date.now(), name: 'ICC Men\'s Cricket World Cup 2023', overs: 50,
        teams: [IND, AFG, AUS, BAN, ENG, NED, NZ, PAK, SA, SL],
        pts: { w: 2, t: 1, nr: 1 }, qualify: 4, tieRule: 'so', tiebreak: 'wins', grounds: {}, impact: false,
        koType: 'semis', venueRule: 'cwc23',
        fixtures: [
            ...LEAGUE.map(([date, a, b, g]) => fx({ a, b, date, venue: G[g] })),
            // The semi-finals take their teams from the final table; the final from the semi-finals.
            fx({ stage: 'SF1', a: null, b: null, seedA: 1, seedB: 4, from: ['P:1', 'P:4'], date: '2023-11-15', venue: G.MUM }),
            fx({ stage: 'SF2', a: null, b: null, seedA: 2, seedB: 3, from: ['P:2', 'P:3'], date: '2023-11-16', venue: G.KOL }),
            fx({ stage: 'F', a: null, b: null, from: ['SF1', 'SF2'], date: '2023-11-19', venue: G.AHM }),
        ],
    };
}
// The 2023 rule for the semi-final grounds: Pakistan play theirs at Eden Gardens; India play theirs at the
// Wankhede unless they meet Pakistan. Returns true when it moved a semi-final.
export function cwc23Venues(t) {
    if (t.venueRule !== 'cwc23') return false;
    const s1 = t.fixtures.find(f => f.stage === 'SF1'), s2 = t.fixtures.find(f => f.stage === 'SF2');
    if (!s1 || !s2 || !s1.a || !s1.b || !s2.a || !s2.b || s1.matchId || s2.matchId || s1.manual || s2.manual) return false;
    const has = (f, n) => f.a === n || f.b === n;
    const wantKol = has(s1, PAK) ? s1 : has(s2, PAK) ? s2 : has(s2, IND) ? s1 : has(s1, IND) ? s2 : null;
    if (!wantKol) return false;
    const other = wantKol === s1 ? s2 : s1;
    if (wantKol.venue === G.KOL && other.venue === G.MUM) return false;
    wantKol.venue = G.KOL; other.venue = G.MUM;
    return true;
}