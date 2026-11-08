(() => {
    const C = window.CONFIG;
    document.documentElement.classList.add("js");
    const $ = s => document.querySelector(s);
    const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const pad = n => String(n).padStart(2, "0");
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const tilt = (max = 4) => (rnd() * 2 - 1) * max;

    /* ---------- paper grain (generated once) ---------- */
    (function grain() {
        const c = document.createElement("canvas"); c.width = c.height = 180;
        const x = c.getContext("2d"); const d = x.createImageData(180, 180);
        for (let i = 0; i < d.data.length; i += 4) {
            const v = 120 + Math.random() * 100; d.data[i] = v; d.data[i + 1] = v * .92; d.data[i + 2] = v * .82;
            d.data[i + 3] = Math.random() < .5 ? Math.random() * 17 : 0;
        }
        x.putImageData(d, 0, 0);
        document.documentElement.style.setProperty("--grain", `url(${c.toDataURL()})`);
    })();

    /* ---------- placeholder film photos ---------- */
    const moods = [
        ["#f6b26b", "#e06666", "#4c3a51"], ["#ffd9a0", "#c27c5c", "#3e4a3d"], ["#f4c7c3", "#b4837a", "#5b4b58"],
        ["#c8d8c0", "#e8c39e", "#55624f"], ["#fbe3b0", "#d98b6a", "#2f3a4a"], ["#e6b8a2", "#8e6f86", "#2d2a38"]
    ];
    function placeholder(i, ar = "4/5", mono = false) {
        const [w, h] = ar.split("/").map(Number); const W = 640, H = Math.round(W * h / w);
        const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
        const m = moods[i % moods.length];
        const g = x.createLinearGradient(0, 0, W * .3, H); g.addColorStop(0, m[0]); g.addColorStop(.55, m[1]); g.addColorStop(1, m[2]);
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        for (let k = 0; k < 6; k++) {
            const cx = rnd() * W, cy = rnd() * H, r = 80 + rnd() * 260; const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            rg.addColorStop(0, m[k % 3] + "aa"); rg.addColorStop(1, m[k % 3] + "00"); x.fillStyle = rg; x.fillRect(0, 0, W, H);
        }
        const lk = x.createRadialGradient(0, H * .2, 0, 0, H * .2, W * .7); lk.addColorStop(0, "rgba(255,170,90,.55)"); lk.addColorStop(1, "rgba(255,170,90,0)");
        x.fillStyle = lk; x.fillRect(0, 0, W, H);
        const id = x.getImageData(0, 0, W, H);
        for (let p = 0; p < id.data.length; p += 4) {
            const n = (Math.random() - .5) * 26; id.data[p] += n; id.data[p + 1] += n; id.data[p + 2] += n;
            if (mono) { const l = id.data[p] * .3 + id.data[p + 1] * .59 + id.data[p + 2] * .11; id.data[p] = id.data[p + 1] = id.data[p + 2] = l; }
        }
        x.putImageData(id, 0, 0);
        x.fillStyle = "rgba(255,248,238,.85)"; x.font = `${Math.round(W / 14)}px Caveat, cursive`; x.textAlign = "center";
        x.fillText("your photo here", W / 2, H / 2);
        return c.toDataURL("image/jpeg", .86);
    }
    let phIndex = 0;
    const src = (s, ar, mono) => s ? esc(s) : placeholder(phIndex++, ar, mono);
    const photo = (s, ar, stamp, cap) =>
        `<span class="ph" data-cap="${esc(cap)}" data-stamp="${esc(stamp)}"><img alt="${esc(cap || "a photo of us")}" src="${src(s, ar)}">${stamp ? `<span class="date-stamp">${esc(stamp)}</span>` : ""}</span>`;

    const washes = ["var(--rose)", "var(--sage)", "var(--butter)", "var(--sky)", "rgba(168,24,43,.55)"];
    const tapeKinds = ["", "dots", "grid"];
    function washi(pos = "top") {
        const w = washes[Math.floor(rnd() * washes.length)], k = tapeKinds[Math.floor(rnd() * 3)];
        const r = tilt(14);
        const place = pos === "corner"
            ? `top:-10px;left:-24px;transform:rotate(${-38 + r / 3}deg)`
            : `top:-13px;left:calc(50% - 48px);transform:rotate(${r}deg)`;
        return `<span class="washi ${k}" style="--wash:${w};${place}"></span>`;
    }

    /* ---------- always start at the top, no scrolling until the book is open ---------- */
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}
    const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    toTop();
    window.addEventListener("pageshow", toTop);
    document.documentElement.classList.add("locked");
    let rollCounter = () => {};
    const unlockScroll = () => { toTop(); document.documentElement.classList.remove("locked"); setTimeout(() => rollCounter(), 350); };

    /* ---------- soothing background music (generated live, no file needed) ----------
       soft pad chords + a slow music-box melody. fades out while any song / voice memo plays. */
    const bg = (() => {
        const btn = $("#musicBtn");
        const VOL = Math.max(0, Math.min(1, C.bgVolume ?? .5));
        const CL = 9;                                                     // seconds per chord
        const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]]; // Cmaj7, Am7, Fmaj7, G
        const SCALE = [72, 74, 76, 79, 81, 84, 86];                       // C major pentatonic, music-box range
        const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
        const pick = a => a[Math.floor(Math.random() * a.length)];
        const playing = new Set();
        let ctx, master, padBus, bellBus, started = false, revealed = false, firstFade = true, suspendT;
        let nextChord = 0, ci = 0, nextNote = 0, mi = 2;
        let muted = false; try { muted = localStorage.getItem("bgMuted") === "1"; } catch (e) {}

        function build() {
            master = ctx.createGain(); master.gain.value = 0;
            const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
            const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2600;
            const len = Math.floor(ctx.sampleRate * 4.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
            for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
            const verb = ctx.createConvolver(); verb.buffer = ir;
            const dry = ctx.createGain(); dry.gain.value = .55;
            const wet = ctx.createGain(); wet.gain.value = .75;
            padBus = ctx.createBiquadFilter(); padBus.type = "lowpass"; padBus.frequency.value = 900; padBus.Q.value = .3;
            bellBus = ctx.createGain(); bellBus.gain.value = 1;
            padBus.connect(tone); bellBus.connect(tone);
            tone.connect(dry); tone.connect(verb); verb.connect(wet);
            dry.connect(comp); wet.connect(comp); comp.connect(master); master.connect(ctx.destination);
        }
        function pad(m, t, dur) {
            [-7, 7].forEach(det => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = "triangle"; o.frequency.value = mtof(m); o.detune.value = det;
                g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.024, t + 3);
                g.gain.setValueAtTime(.024, t + dur - .5); g.gain.linearRampToValueAtTime(0, t + dur + 3);
                o.connect(g); g.connect(padBus); o.start(t); o.stop(t + dur + 3.1);
            });
        }
        function bass(m, t, dur) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = mtof(m);
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + 2);
            g.gain.setValueAtTime(.07, t + dur - .5); g.gain.linearRampToValueAtTime(0, t + dur + 2.5);
            o.connect(g); g.connect(padBus); o.start(t); o.stop(t + dur + 2.6);
        }
        function bell(m, t, v) {
            const out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
            if (out.pan) out.pan.value = (Math.random() * 2 - 1) * .5;
            out.connect(bellBus);
            [[1, v, 3.4], [2, v * .22, 1.2], [3.01, v * .06, .6]].forEach(([h, a, d]) => {      // a little music-box timbre
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = "sine"; o.frequency.value = mtof(m) * h;
                g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
                o.connect(g); g.connect(out); o.start(t); o.stop(t + d + .05);
            });
        }
        function schedule() {
            const ahead = ctx.currentTime + 1.5;
            while (nextChord < ahead) {
                const ch = CHORDS[ci % CHORDS.length];
                ch.forEach(m => pad(m, nextChord, CL)); bass(ch[0] - 12, nextChord, CL);
                ci++; nextChord += CL;
            }
            while (nextNote < ahead) {
                if (Math.random() < .62) {
                    mi = Math.max(0, Math.min(SCALE.length - 1, mi + pick([-2, -1, -1, 1, 1, 2])));
                    bell(SCALE[mi], nextNote, .045 + Math.random() * .03);
                    if (Math.random() < .18) bell(SCALE[Math.max(0, mi - 2)], nextNote + .03, .03);
                }
                nextNote += pick([.75, 1.5, 1.5, 2.25]);
            }
        }
        function state() { return muted ? "off" : playing.size ? "paused" : "on"; }
        function paintBtn() {
            const st = state();
            btn.dataset.state = st;
            btn.querySelector(".mb-txt").textContent = st === "off" ? "music off" : st === "paused" ? "music paused" : "music on";
            btn.setAttribute("aria-pressed", String(!muted));
        }
        function apply() {
            paintBtn();
            if (!started) return;
            const on = !muted && !playing.size && !document.hidden, t = ctx.currentTime;
            clearTimeout(suspendT);
            master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
            if (on) {
                if (ctx.state !== "running") ctx.resume().catch(() => {});
                master.gain.linearRampToValueAtTime(VOL * 2.4, t + (firstFade ? 5 : 1.8)); firstFade = false;
            } else {
                master.gain.linearRampToValueAtTime(0, t + .8);
                suspendT = setTimeout(() => { if (muted || playing.size || document.hidden) ctx.suspend().catch(() => {}); }, 1000);
            }
        }
        function start() {                                     // must be called from a tap / key press
            if (started || C.bgMusic === false) return;
            const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            try { ctx = new AC(); } catch (e) { return; }
            build(); started = true;
            nextChord = ctx.currentTime + .1; nextNote = ctx.currentTime + 2.5;
            schedule(); setInterval(schedule, 250);
            apply();
        }
        function reveal() { if (!started || revealed) return; revealed = true; btn.hidden = false; paintBtn(); }
        function hold(el, isPlaying) { isPlaying ? playing.add(el) : playing.delete(el); apply(); }
        btn.addEventListener("click", () => {
            muted = !muted; try { localStorage.setItem("bgMuted", muted ? "1" : "0"); } catch (e) {}
            if (!started) { start(); reveal(); } else apply();
        });
        document.addEventListener("visibilitychange", apply);
        return { start, reveal, hold, get ctx() { return ctx; }, get master() { return master; } };
    })();

    /* ---------- lock, then the book cover (she opens it herself) ---------- */
    const lock = $("#lock"), cover = $("#cover");
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    (function buildCover() {
        const s0 = seed, p0 = phIndex;                      // don't disturb the scrapbook's layout randomness
        const img = C.cover && C.cover.src ? esc(C.cover.src) : placeholder(0, "1/1");
        seed = s0; phIndex = p0;
        const stamp = (C.cover && C.cover.stamp) || "";
        const dm = String(C.since || "").match(/^(\d{1,2})\D+(\d{1,2})/);
        const short = dm ? `${pad(dm[1])}.${pad(dm[2])}` : "";
        cover.querySelector(".cover-wrap").innerHTML = `
      <div class="cover-pages"><div class="first-page"><p class="type tiny">volume one · ${esc(C.since)}</p><p class="hand fp-line">the story so far,</p><p class="hand fp-line">for ${esc(C.to)} ♡</p></div><span class="cover-ribbon"></span></div>
      <div class="cover-board">
        <div class="cover-front">
          <span class="corner tr"></span><span class="corner br"></span>
          <div class="cover-pol"><span class="washi" style="--wash:var(--rose);top:-11px;left:calc(50% - 42px);transform:rotate(-5deg)"></span><span class="cph"><img alt="" src="${img}">${stamp ? `<span class="date-stamp">${esc(stamp)}</span>` : ""}</span><span class="cap">us ♡</span></div>
          <div class="cover-label"><span class="type tiny">volume one</span><span class="plate-title">a little book of us</span><span class="hand">for ${esc(C.to)}</span></div>
          ${short ? `<span class="cover-date">${short}</span>` : ""}
          <svg class="cover-heart" viewBox="0 0 100 92" aria-hidden="true"><path d="M50 88C22 67 4 51 4 29 4 14 15 4 28 4c9 0 17 5 22 13C55 9 63 4 72 4c13 0 24 10 24 25 0 22-18 38-46 59z"/></svg>
        </div>
        <div class="cover-inside"><div class="bookplate"><span class="type tiny">ex libris</span><span class="bp-small">this book belongs to</span><span class="hand bp-name">${esc(C.to)}</span><span class="bp-small">with love, ${esc(C.from)}</span></div></div>
      </div>
      <span class="cover-strap"></span>`;
    })();
    let coverState = 0; // 0 closed, 1 opening, 2 gone
    function hideCover() { if (coverState === 2) return; coverState = 2; cover.classList.add("gone"); unlockScroll(); setTimeout(bg.reveal, 900); }
    function showCover() { cover.classList.add("in"); setTimeout(() => cover.focus({ preventScroll: true }), 300); }
    function openCover() {
        if (!cover.classList.contains("in")) return;
        if (coverState === 1) { hideCover(); return; }        // a second tap skips ahead
        if (coverState) return;
        coverState = 1; toTop(); bg.start();
        if (reduceMotion) { hideCover(); return; }
        cover.classList.add("open");                          // strap snaps off, cover swings open
        setTimeout(hideCover, 3500);                          // a moment to see the inside, then into the book
    }
    cover.addEventListener("click", openCover);
    cover.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCover(); } });
    if (!C.password) { lock.classList.add("gone"); showCover(); }
    else { $("#hintLbl").textContent = C.passwordHint; setTimeout(() => $("#pw").focus(), 400); }
    $("#lockForm").addEventListener("submit", e => {
        e.preventDefault();
        if ($("#pw").value.trim().toLowerCase() === String(C.password).toLowerCase()) {
            toTop(); bg.start(); lock.classList.add("gone"); setTimeout(showCover, 500);
        } else {
            $("#lockMsg").textContent = "hmm, not quite. think back ♡";
            const f = $(".lock-env"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
        }
    });

    /* ---------- hero ---------- */
    const fonts = ["'Abril Fatface',serif", "'Archivo Black',sans-serif", "'Special Elite',monospace", "'DM Serif Display',serif", "'Instrument Serif',serif", "'Courier Prime',monospace"]; // single quotes: these go inside a style="..." attribute
    const swatches = [["#fbf8f2", "#2b221e"], ["#a8182b", "#fbe9ea"], ["#2b221e", "#f3ece1"], ["#f1c9cb", "#7e0f1f"], ["#f6e7a8", "#2b221e"], ["#c3cba8", "#2b221e"], ["#c9d8e4", "#2b221e"]];
    let ci2 = 0;
    $("#ransom").innerHTML = C.title.split(" ").map(word => `<span class="word">${[...word].map(ch => { const i = ci2++;
        const [bg, fg] = swatches[(i * 3 + 1) % swatches.length];
        const f = fonts[(i * 5 + 2) % fonts.length];
        const italic = i % 4 === 1 ? "font-style:italic;" : "";
        return `<span class="ch" aria-hidden="true" style="background:${bg};color:${fg};font-family:${f};${italic}--r:${tilt(7).toFixed(1)}deg;--y:${tilt(6).toFixed(0)}px">${esc(ch)}</span>`;
    }).join("")}</span>`).join(`<span class="sp"></span>`);
    $("#byline").textContent = `for ${C.to}, from ${C.from}`;
    const sinceN = C.since.replace(/\D/g, "");
    $("#ticket").innerHTML = `<div class="main"><span>admit two · friends since ${esc(C.friendsSince || "")}</span><b>US, OFFICIALLY</b><span>since ${esc(C.since)}</span></div>
  <div class="stub"><span>no.</span><b>${esc(sinceN.slice(0, 6))}</b><span>row ♡</span></div>`;
    /* ---------- live "together for" counter ---------- */
    (function counter() {
        const el = $("#counter");
        const m = String(C.since || "").match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
        if (C.counter === false || !m) { el.hidden = true; return; }
        const [hh, mm] = String(C.sinceTime || "").split(":").map(Number);
        const start = new Date(+m[3], +m[2] - 1, +m[1], hh || 0, mm || 0);
        const addDays = n => { const x = new Date(start); x.setDate(x.getDate() + n); return x; };
        const addMonths = n => {
            const x = new Date(start); x.setDate(1); x.setMonth(x.getMonth() + n);
            x.setDate(Math.min(start.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x;
        };
        const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const DAY_MARKS = [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000];
        const monthName = n => n % 12 === 0 ? (n === 12 ? "1 year" : `${n / 12} years`) : n === 6 ? "half a year" : n === 1 ? "1 month" : `${n} months`;
        function milestone(now) {
            const t = day0(now), c = [];
            let n = 1; while (day0(addMonths(n)) < t) n++;
            c.push([day0(addMonths(n)), monthName(n)]);
            const dm = DAY_MARKS.find(k => day0(addDays(k)) >= t);
            if (dm) c.push([day0(addDays(dm)), `${dm} days`]);
            c.sort((a, b) => a[0] - b[0]);
            return { label: c[0][1], inDays: Math.round((c[0][0] - t) / 864e5) };
        }

        el.innerHTML = `<div class="odo"><span class="odo-lbl">together for</span><span class="odo-digits" aria-hidden="true"></span><span class="odo-unit hand">days</span><span class="odo-time" aria-hidden="true"></span></div><p class="hand odo-next"></p>`;
        const digitsEl = el.querySelector(".odo-digits"), timeEl = el.querySelector(".odo-time"), nextEl = el.querySelector(".odo-next");
        let wheels = [], rolled = false, shownDays = -1, shownDate = "";
        const digits = n => String(n).padStart(3, "0");
        function build(len) {
            digitsEl.innerHTML = Array.from({ length: len }, (_, i) =>
                `<span class="wheel"><span class="strip" style="--dl:${(i * .18).toFixed(2)}s">${[...Array(10).keys()].map(k => `<span>${k}</span>`).join("")}</span></span>`).join("");
            wheels = [...digitsEl.querySelectorAll(".strip")];
            void digitsEl.offsetWidth;
        }
        function show(days) {
            const s = digits(days);
            if (wheels.length !== s.length) build(s.length);
            wheels.forEach((w, i) => w.style.setProperty("--d", s[i]));
        }
        function tick() {
            const now = new Date();
            if (now < start) { el.hidden = true; return; }
            el.hidden = false;
            let days = Math.floor((now - start) / 864e5);           // first guess, then fix for clock changes
            while (days > 0 && addDays(days) > now) days--;
            while (addDays(days + 1) <= now) days++;
            const r = Math.floor((now - addDays(days)) / 1000);
            timeEl.textContent = `+ ${pad(Math.floor(r / 3600))}h ${pad(Math.floor(r % 3600 / 60))}m ${pad(r % 60)}s`;
            if (days !== shownDays) {
                if (!wheels.length) build(digits(days).length);
                shownDays = days;
                el.setAttribute("aria-label", `together for ${days} days`);
                if (rolled) show(days);
            }
            if (now.toDateString() !== shownDate) {
                shownDate = now.toDateString();
                const ms = milestone(now);
                nextEl.classList.toggle("today", ms.inDays === 0);
                nextEl.textContent = ms.inDays === 0 ? `today is our ${ms.label} ♡`
                    : ms.inDays === 1 ? `${ms.label} tomorrow ♡`
                        : `next: ${ms.label}, in ${ms.inDays} days`;
            }
        }
        tick();
        setInterval(tick, 1000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
        rollCounter = () => { if (rolled) return; rolled = true; if (shownDays >= 0) show(shownDays); };
    })();

    $("#booth").innerHTML = (C.booth || []).map(s => `<span class="ph"><img alt="photo booth" src="${src(s, "4/3.3", true)}"></span>`).join("");
    if (C.cover) $("#heroPol").innerHTML = `<button class="polaroid" style="--r:6deg;--ar:4/5">${washi()}${photo(C.cover.src, "4/5", C.cover.stamp, C.cover.caption)}<span class="cap">${esc(C.cover.caption)}</span></button>`;

    /* ---------- cassettes ---------- */
    function cassette(btn, file) {
        if (!file) { btn.title = "add an audio file in config.js"; return null; }
        const a = new Audio(file); a.loop = btn.id === "songTape";
        btn.addEventListener("click", () => a.paused ? a.play().catch(() => {}) : a.pause());
        a.addEventListener("play", () => { btn.classList.add("playing"); bg.hold(a, true); });
        a.addEventListener("pause", () => { btn.classList.remove("playing"); bg.hold(a, false); });
        a.addEventListener("ended", () => { btn.classList.remove("playing"); bg.hold(a, false); });
        return a;
    }
    $("#songTitle").textContent = C.song.title || "our song";
    if (!C.song.src) $("#songTape").addEventListener("click", e => e.currentTarget.classList.toggle("playing"));
    cassette($("#songTape"), C.song.src);
    if (C.finalLetter.voice) { $("#voiceTape").hidden = false; cassette($("#voiceTape"), C.finalLetter.voice); }

    /* ---------- scrapbook spreads: hand-placed, overlapping collages ---------- */
    const richText = t => String(t ?? "").split(/<br\s*\/?>/i).map(esc).join("<br>");
    function memento(m) {
        switch (m.type) {
            case "ticket": return `<div class="m m-ticket${m.red ? " red" : ""}"><div class="a"><span>admit one</span><b>${esc(m.title)}</b><span>${esc(m.date)}</span></div><div class="s">no. ${pad(Math.floor(rnd() * 90 + 10))}${pad(Math.floor(rnd() * 99))}</div></div>`;
            case "receipt": return `<div class="m m-receipt"><b>${esc(m.title)}</b><span class="dt">${esc(m.date)}</span>${(m.lines || []).map(([a, b]) => `<div class="row"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join("")}<hr><div class="row tot"><span>total</span><span>${esc(m.total)}</span></div><span class="thx">thank you, come again ♡</span></div>`;
            case "note": return `<div class="m m-note torn">${esc(m.text)}</div>`;
            case "sticker": return `<div class="m"><span class="m-sticker${m.heart ? " heart" : ""}" style="--sc:${washes[Math.floor(rnd() * 4)]}">${richText(m.text)}</span></div>`;
            case "tag": return `<div class="m m-tag"><span class="hole"></span><span class="lbl">${esc(m.label)}</span><span class="val">${esc(m.text)}</span></div>`;
            case "chat": return `<div class="m m-chat"><div class="chat-top"><span class="dot"></span><b>${esc(m.with || C.to)}</b><span>${esc(m.date || "")}</span></div>${(m.messages || []).map(([who, t]) => `<p class="b ${who === "me" ? "me" : "them"}">${esc(t)}</p>`).join("")}</div>`;
            case "leaf": return `<div class="m"><svg class="m-leaf" viewBox="0 0 100 160" aria-hidden="true"><path d="M50 150C48 120 52 95 50 70 30 62 14 44 16 22 34 24 46 40 50 58 54 40 66 24 84 22 86 44 70 62 50 70"/><path class="vein" d="M50 155V40M50 90 34 78M50 110 66 98M50 70 28 40M50 66 72 38"/></svg></div>`;
        }
        return "";
    }
// slot = [left %, top %, width %, rotation]; two mirrored layouts alternate between pages
    const PHOTO_SLOTS = [[2, 3, 30, -4], [29, 15, 26, 3], [56, 1, 31, -2], [6, 52, 28, 5], [60, 46, 31, -3]];
    const MEMO_SLOTS = [[37, 63, 20, -6], [86, 4, 13, 9], [40, 0, 15, -7]];
    const FEW_PHOTO_SLOTS = [[3, 6, 32, -4], [60, 12, 30, 3]];
    const FEW_MEMO_SLOTS = [[38, 3, 23, -4], [36, 48, 24, 4], [36, 80, 10, 7], [86, 74, 11, -8], [86, 1, 13, 10]];
    const ONE_PHOTO_SLOTS = [[4, 4, 34, -4]];
    const ONE_MEMO_SLOTS = [[41, 1, 22, 3], [65, 9, 25, -3], [42, 50, 21, -5], [89, -1, 9, 10], [68, 62, 20, 4]];
    const NONE_MEMO_SLOTS = [[3, 6, 27, -4], [34, 14, 26, 3], [64, 4, 26, -3], [10, 50, 25, 4], [44, 56, 26, -4], [78, 48, 14, 9]];
    const mirror = ([l, t, w, r]) => [100 - l - w, t, w, -r];
    const pages = [];
    C.chapters.forEach((ch, ci) => {
        const photos = ch.photos || [], memos = ch.mementos || [];
        if (!photos.length) { pages.push({ ch, ci, cont: false, photos: [], mementos: memos.slice(0, 6) }); return; }
        for (let i = 0; i < photos.length; i += 5) {
            const chunk = photos.slice(i, i + 5);
            pages.push({ ch, ci, cont: i > 0, photos: chunk, mementos: i === 0 ? memos.slice(0, chunk.length <= 2 ? 5 : 3) : [] });
        }
    });
    $("#spreads").innerHTML = pages.map((pg, pi) => {
        const flip = pi % 2 === 1;
        const n = pg.photos.length;
        const pSlots = n === 1 ? ONE_PHOTO_SLOTS : n <= 2 ? FEW_PHOTO_SLOTS : PHOTO_SLOTS;
        const mSlots = n === 0 ? NONE_MEMO_SLOTS : n === 1 ? ONE_MEMO_SLOTS : n <= 2 ? FEW_MEMO_SLOTS : MEMO_SLOTS;
        const car = n === 0 ? "10/3.6" : n === 1 ? "10/5.6" : n <= 2 ? "10/6.3" : n <= 3 ? "10/5.8" : "10/7.2";
        const tw = t => (t * Number(car.split("/")[1]) / 10).toFixed(2);   // top as % of page width
        let d = 0;
        const items = pg.photos.map((p, k) => {
            let [l, t, w, r] = pSlots[k]; if (flip) [l, t, w, r] = mirror([l, t, w, r]);
            r = (r + tilt(1.5)).toFixed(1);
            const tape = k % 2 ? washi("corner") : washi();
            const pos = `--l:${l}%;--t:${t}%;--tw:${tw(t)};--w:${w}%;--r:${r}deg;--z:${k + 1};--d:${(d++ * .09).toFixed(2)}s`;
            if (p.print) return `<button class="print rv wide" style="${pos};--ar:${p.ar || "3/2"}">${tape}${photo(p.src, p.ar || "3/2", p.stamp, p.caption)}</button>`;
            return `<button class="polaroid rv${n === 1 ? " solo" : ""}" style="${pos};--ar:${p.ar || "1/1"}">${tape}${photo(p.src, p.ar || "1/1", p.stamp, p.caption)}<span class="cap">${esc(p.caption)}</span></button>`;
        });
        pg.mementos.forEach((m, k) => {
            let [l, t, w, r] = mSlots[k]; if (flip) [l, t, w, r] = mirror([l, t, w, r]);
            const html = memento(m).replace('class="m', `style="--l:${l}%;--t:${t}%;--tw:${tw(t)};--w:${w}%;--r:${(r + tilt(2)).toFixed(1)}deg;--d:${(d++ * .09).toFixed(2)}s" class="rv m`);
            items.splice(Math.min(2 + k * 2, items.length), 0, html); // weave mementos between photos on phones
        });
        const scrawl = pg.ch.scrawl && !pg.cont ? `<span class="scrawl" style="${flip ? "left" : "right"}:6%;bottom:4%;transform:rotate(${tilt(8).toFixed(1)}deg)">${esc(pg.ch.scrawl)} ${flip ? "↗" : "↖"}</span>` : "";
        return `<article class="spread"><div class="spread-page torn">
      <div class="chapter"><h2>${esc(pg.ch.title)}${pg.cont ? " (cont.)" : ""}</h2><span>${esc(pg.ch.when)}</span></div>
      <div class="collage free" style="--car:${car}">${items.join("")}</div>${scrawl}
    </div></article>`;
    }).join("");

    /* ---------- desktop: trim each scrapbook page to its contents ---------- */
    function fitCollages() {
        const desktop = innerWidth > 760 && CSS.supports("container-type", "inline-size");
        document.querySelectorAll(".collage.free").forEach(c => {
            if (!desktop) { c.style.height = ""; c.style.aspectRatio = ""; return; }
            let bottom = 0;
            for (const k of c.children) bottom = Math.max(bottom, k.offsetTop + k.offsetHeight);
            c.style.aspectRatio = "auto"; c.style.height = Math.ceil(bottom + 34) + "px";
        });
    }
    let fitT; const refit = () => { clearTimeout(fitT); fitT = setTimeout(fitCollages, 60); };
    fitCollages();
    addEventListener("resize", refit); addEventListener("load", refit);
    if (document.fonts) document.fonts.ready.then(refit);
    document.querySelectorAll(".collage img").forEach(im => im.complete || im.addEventListener("load", refit));

    /* ---------- optional sections: hide what has no photos ---------- */
    const hasAny = a => (a || []).length > 0;
    if (!hasAny(C.filmRoll)) $("#roll").hidden = true;
    if (!hasAny(C.booth)) $("#booth").hidden = true;
    if (!C.cover) $("#heroPol").hidden = true;

    /* ---------- film roll ---------- */
    $("#film").innerHTML = (C.filmRoll || []).map((s, i) =>
            `<div class="frame"><span class="fnum">${i * 2 + 1} ▸ ${i * 2 + 1}A</span>${photo(s, "3/2", "", "")}<span class="fnum b">400 ▸ ${i * 2 + 2}</span></div>`).join("") +
        `<span class="pin" style="left:18px"></span><span class="pin" style="right:18px;left:auto"></span>`;

    /* ---------- lightbox ---------- */
    const lb = $("#lightbox");
    document.addEventListener("click", e => {
        const ph = e.target.closest(".ph"); if (!ph || ph.closest("#lightbox") || ph.closest(".booth")) return;
        $("#lbImg").src = ph.querySelector("img").src;
        $("#lbStamp").textContent = ph.dataset.stamp || "";
        $("#lbCap").textContent = ph.dataset.cap || "";
        lb.showModal();
    });
    $("#lbClose").onclick = () => lb.close();
    lb.addEventListener("click", e => { if (e.target === lb) lb.close(); });

    /* ---------- sticky notes ---------- */
    const notes = $("#notes"), colors = ["var(--butter)", "var(--rose)", "var(--sage)", "var(--sky)"];
    const R = C.reasons; let top = 0;
    notes.innerHTML = R.map((t, i) => `<div class="sticky" style="--c:${colors[i % 4]}"><span class="num">no. ${pad(i + 1)}</span><p>${esc(t)}</p><span class="num">tap to tear off →</span></div>`).join("");
    const stickies = [...notes.children];
    const offs = stickies.map(() => [tilt(5).toFixed(1), tilt(10).toFixed(0), tilt(8).toFixed(0)]);
    function layoutNotes() {
        stickies.forEach((s, i) => {
            const rel = (i - top + R.length) % R.length;
            s.classList.remove("off");
            s.style.zIndex = R.length - rel;
            s.style.opacity = rel > 3 ? 0 : 1;
            const [r, x, y] = rel === 0 ? [-1.5, 0, 0] : offs[i];
            s.style.setProperty("--r", r + "deg"); s.style.setProperty("--x", x + "px"); s.style.setProperty("--y", y + "px");
            s.setAttribute("aria-hidden", rel === 0 ? "false" : "true");
            s.tabIndex = rel === 0 ? 0 : -1; s.setAttribute("role", "button");
        });
        $("#noteCount").textContent = `${top + 1} of ${R.length} (and counting)`;
    }
    function tear() {
        const cur = stickies[top]; cur.classList.add("off");
        setTimeout(() => { top = (top + 1) % R.length; layoutNotes(); }, 420);
    }
    notes.addEventListener("click", e => { if (e.target.closest(".sticky") === stickies[top]) tear(); });
    notes.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === stickies[top]) { e.preventDefault(); tear(); } });
    layoutNotes();

    /* ---------- envelopes: the flap lifts and the letter slides out ---------- */
    const box = $("#letterBox"), stage = $("#stage");
    let opened = {}; try { opened = JSON.parse(localStorage.getItem("opened") || "{}"); } catch (e) {}
    const stamps = ["♡", "✿", "☾", "✦", "♡", "❀"];
    const envColors = ["#e8d3b2", "#dfc6a5", "#f1c9cb"];
    $("#envelopes").innerHTML = C.letters.map((l, i) =>
        `<button class="env rv${opened[i] ? " read" : ""}" data-i="${i}" style="--r:${tilt(3).toFixed(1)}deg" aria-label="Open when ${esc(l.when)}">
    <span class="postage"><i>${stamps[i % stamps.length]}</i></span><span class="wax">♡</span>
    <span class="to"><small>open when</small>${esc(l.when)}</span></button>`).join("");
    let timers = [];
    document.querySelectorAll(".env").forEach(b => b.addEventListener("click", () => {
        const i = +b.dataset.i, l = C.letters[i];
        timers.forEach(clearTimeout); timers = [];
        stage.className = "stage";
        stage.style.setProperty("--ec", envColors[i % 3]);
        stage.innerHTML = `<div class="env-back"></div>
    <div class="letter-paper"><button class="letter-close type" id="lc">close ×</button><p class="to">open when ${esc(l.when)} —</p><p class="body">${esc(l.body)}</p><p class="sig">${esc(C.from)} ♡</p></div>
    <div class="env-front"></div><div class="env-flap"><span class="wax">♡</span></div>`;
        box.showModal(); $("#lc").onclick = () => box.close();
        ruleLetter(stage.querySelector(".letter-paper"));
        const steps = [["s1", 450], ["s2", 1150], ["s3", 2000]];
        steps.forEach(([cls, t]) => timers.push(setTimeout(() => stage.classList.add(cls), t)));
        opened[i] = 1; b.classList.add("read"); try { localStorage.setItem("opened", JSON.stringify(opened)); } catch (e) {}
    }));
    box.addEventListener("click", e => { if (e.target === box) box.close(); });

    /* ---------- someday list ---------- */
    let done = {}; try { done = JSON.parse(localStorage.getItem("someday") || "{}"); } catch (e) {}
    const list = $("#list");
    list.innerHTML = C.someday.map((t, i) => `<li class="${done[i] ? "done" : ""}" data-i="${i}" role="checkbox" aria-checked="${!!done[i]}" tabindex="0"><span class="box"></span><span class="t">${esc(t)}</span></li>`).join("");
    list.querySelectorAll("li").forEach(li => {
        const flip = () => { const i = li.dataset.i; done[i] = !done[i]; li.classList.toggle("done", done[i]); li.setAttribute("aria-checked", done[i]); try { localStorage.setItem("someday", JSON.stringify(done)); } catch (e) {} };
        li.addEventListener("click", flip);
        li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    });

    /* ---------- paper-clipped polaroid on the notebook ---------- */
    if (C.somedayPhoto) $("#clipPol").innerHTML = `<span class="paperclip"></span><button class="polaroid" style="--r:7deg;--ar:1/1">${photo(C.somedayPhoto.src, "1/1", C.somedayPhoto.stamp || "", C.somedayPhoto.caption)}<span class="cap">${esc(C.somedayPhoto.caption)}</span></button>`;
    else $("#clipPol").hidden = true;

    /* ---------- heart cursor (mouse only) ---------- */
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) document.documentElement.classList.add("heart-cursor");

    /* ---------- final letter ---------- */
    const F = C.finalLetter;
    $("#finalLetter").innerHTML = F.scan
        ? `<div class="scan">${washi()}<img src="${esc(F.scan)}" alt="a handwritten letter"></div>`
        : `<div class="letter-paper torn"><p class="to">dear ${esc(C.to)},</p><p class="body">${esc(F.body)}</p><p class="sig">always, ${esc(C.from)}</p></div>`;
    $("#footer").textContent = `made by hand, for ${C.to} ♡`;

    /* ---------- ruled letter paper: line the rules up under the handwriting ---------- */
    function ruleLetter(paper) {
        const b = paper && paper.querySelector(".body"); if (!b) return;
        paper.style.setProperty("--rule", (b.offsetTop % 38) + "px");
    }
    const ruleAll = () => document.querySelectorAll(".letter-paper").forEach(ruleLetter);
    ruleAll(); addEventListener("resize", ruleAll);
    if (document.fonts) document.fonts.ready.then(ruleAll);

    /* ---------- gentle reveal (only for things below the fold) ---------- */
    if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove("pre"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -6% 0px" });
        document.querySelectorAll(".rv").forEach(el => { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add("pre"); io.observe(el); } });
    }
})();