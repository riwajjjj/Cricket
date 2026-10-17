# Crease: cricket stats lab

A browser-based cricket calculator: batting and bowling rates, net run rate, rain-affected targets, impact ratings, player comparison and a ball-by-ball live scorer with projections and win probability.

## Running it

The JavaScript uses ES modules (`import` / `export`), and browsers refuse to load modules from a file opened by double-click (`file://`). Serve the folder over a local web server instead:

- **VS Code:** install the Live Server extension, right-click `index.html` and choose **Open with Live Server**.
- **Python:** in this folder run `python -m http.server 8000`, then open <http://localhost:8000>.
- **Node:** `npx serve .`

Everything the app needs is in this folder, including Chart.js and the fonts, so it works with no internet connection.

## Offline and installing as an app

Once the app has been opened over `http://localhost` or `https://`, a service worker (`sw.js`) keeps a copy of every file. After that it opens and works with no connection at all.

- **Desktop (Chrome or Edge):** an **Install app** button appears in the header. It adds Crease to your apps with its own window and icon.
- **Phone:** installing needs the app served over **https**, so host the folder somewhere free such as GitHub Pages or Netlify, then open it on the phone.
  - **Android (Chrome):** tap **Install app**, or use **Add to Home screen** from the menu.
  - **iPhone (Safari):** use **Share → Add to Home Screen**.

When you change files, the app picks up the new versions on the next visit. If you add or remove files, also update the list and the `VERSION` name at the top of `sw.js`.

## Backup and restore

Saved players, matches, squads, tournaments, earlier stats and the match in progress live in the browser's storage. On the **Saved** tab:

- **Back up now** downloads everything as one `.json` file (or lets you copy it).
- **Restore from backup** loads that file in either of two ways:
  - **Merge:** adds the backup's players, matches, squads, tournaments and earlier stats. When both copies exist, the newer one wins.
  - **Replace everything:** swaps everything for the backup's contents.

Use backup and restore to move your data to a new phone or computer too.

## Player records, ball editing and tournaments

- **Players tab:** every match you finish in the live scorer is saved automatically and added to each player's career (batting, bowling and fielding). Players are matched by name. "Add earlier stats" lets you enter a player's totals from before you used Crease; scored matches are added on top. Earlier runs entered without balls faced (or runs conceded without overs) still count in the totals and averages, but not in the strike rate or economy.
- **Fixing a ball:** tap any ball in "This over", "Recent overs" or a scorecard's "Ball by ball" list to change it, delete it or add a missed ball before it. The match is replayed from the start with the change. A change that would move the end of an over the next bowler already started is refused, and Undo reverses an edit.
- **Tournament tab:** add teams, generate round-robin fixtures, then for each fixture either score it live (it links itself when it finishes), link a saved match, type in the scores, or mark it as no result. A limited-overs match ended with the live scorer's "No result" button counts as a no result too. The points table sorts by points then net run rate, and "NRR solver" sends a team's results to the Net run rate tab.

## Wagon wheel, match-ups and Test matches

- **Wagon wheel:** tick "Wagon wheel: ask where each scoring shot went" in the live scorer, then after each scoring shot tap where it went on the field (or skip). The wagon wheel chart shows each batter's shots with runs by area, and flips for left-handers (tick "Left-handed" when picking the shot or under the chart).
- **Match-ups:** every ball is credited to that batter and bowler pair. The live scorer shows this match's match-ups; a player's page in the Players tab shows their career match-ups against each opponent.
- **Test matches:** choose "Test match" when setting up. Overs are unlimited, there are up to four innings, and you can declare, enforce or skip the follow-on (200 runs ahead for a 5-day Test, 150 for 3–4 days, 100 for 2, 75 for 1), and use "End as a draw" when time runs out. The scoreboard shows the lead or deficit, and results include "won by an innings and N runs". No free hits are given after no-balls. Test matches count towards player records but can't be put in a tournament points table.

## Tests

The calculations (overs, resources, win chance, batting and bowling figures, net run rate and its solver, rain targets, player records, points tables) have 51 automated checks in `tests/`.

- **In Node 18 or newer:** run `npm test` (or `node --test`) in this folder. Nothing needs installing.
- **In a browser:** start the local server as above and open `/tests/index.html`.

The live scorer itself is checked by hand and by browser scripts, because it works through the page rather than as separate functions.

## Folder layout

```
index.html            the single page; every tab lives here
manifest.webmanifest  app name, icons and colours for installing
sw.js                 service worker: offline copy of every file
package.json          only for `npm test`; the app needs no packages
icons/                app icons
fonts/                bundled fonts (Open Font License, see LICENSES.txt)
vendor/               Chart.js (MIT licence)
css/
  fonts.css           loads the bundled fonts
  base.css            colour tokens (dark and light), fonts, layout, header, tabs, cards, fields
  components.css      buttons, stat tiles, tables, scoreboard, gauges, live scorer, dialogs, responsive rules
js/
  main.js             start-up: builds the page, wires the header, format picker and theme
  router.js           which tab is showing; each tab registers a render function here
  state.js            the selected match format, shared by every module
  maths.js            overs notation, format benchmarks, resource model, win probability
  stats.js            batting, bowling, net run rate, rain target and points-table calculations (no page code)
  groups.js           input fields: building, reading, validating and saving them
  ui.js               stat tiles, counters, warnings, tooltip, dialogs, toast, gauge
  charts.js           Chart.js helpers and theme colours
  export.js           share-as-image and CSV export
  backup.js           backup and restore of everything saved
  records.js          player career records built from finished matches
  pwa.js              offline support and the Install app button
  utils.js            small shared helpers (DOM lookup, number formatting, storage)
  tabs/
    batting.js  bowling.js  nrr.js  dls.js  impact.js  compare.js
    live.js  players.js  tournament.js  saved.js
tests/
  cases.js            the checks, shared by both runners
  maths.test.js       Node runner (npm test)
  index.html          browser runner (with browser.js)
```

## Adding a tab

1. Add a tab button and a `<section class="tab-panel" id="tab-NAME">` to `index.html`.
2. Create `js/tabs/NAME.js`. Define its inputs with `group(...)` from `groups.js` and register `RENDER.NAME = () => { ... }` from `router.js`.
3. Add `NAME` to `TAB_KEYS` in `router.js` and `import './tabs/NAME.js';` in `main.js`.
4. Add `./js/tabs/NAME.js` to the `ASSETS` list in `sw.js` and change its `VERSION`, so the new file works offline.
5. Put any new calculations in `stats.js` and add checks for them to `tests/cases.js`.

## Data

Saved players, matches, the live match and your inputs are stored in this browser's local storage. Nothing is sent anywhere.
