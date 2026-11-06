// Lore: what the brush does, and how the works in the Met's collection were made.
// Used by the lessons, the meditative version and the closing colophon.
//
// Terms are given in English, then the original characters and a romanisation.
// Kept short and plain: this is a companion to drawing, not a textbook.

export const TECHNIQUES = {
  centred: {
    name: "Centred tip", term: "中鋒 zhongfeng",
    how: "Hold the brush upright, the tip travelling down the middle of the line. With a Pencil: keep it vertical.",
    why: "The ink spreads evenly to both edges, so the line looks round and full, as if it had a bone inside it. Calligraphers and painters treat it as the foundation of all brushwork.",
  },
  side: {
    name: "Side tip", term: "側鋒 cefeng",
    how: "Lay the brush over so its belly drags on the paper. With a Pencil: tilt it well over.",
    why: "A broad, uneven mark, crisp on one edge and broken on the other. Painters use it for the faces of rocks, tree bark and the rough texture strokes of landscapes.",
  },
  concealed: {
    name: "Concealed entry", term: "藏鋒 cangfeng",
    how: "Start by pushing the tip a little *against* the way you mean to go, then turn back and travel. End by drawing the tip back into the stroke (回鋒 huifeng).",
    why: "The tip folds inside the stroke, so it begins with a rounded, weighty head instead of a sharp point. It gives the line strength held in reserve.",
  },
  liftpress: {
    name: "Lift and press", term: "提按 ti'an",
    how: "Let the hand rise and sink as it travels: press into the start, lift through the middle, settle again where the stroke turns or ends.",
    why: "The line swells and thins, so it breathes. A line at one pressure looks drawn with a pen, not a brush.",
  },
  flyingwhite: {
    name: "Flying white", term: "飛白 feibai",
    how: "Move quickly with a brush that is running low on ink.",
    why: "The bristles part and the paper shows through in streaks. Calligraphers prized it as the trace of speed; Yuan-dynasty landscape painters built whole hills from dry, broken strokes.",
  },
  pause: {
    name: "Pause and press", term: "頓 dun",
    how: "At a turn or the end of a stroke, stop for a breath and press.",
    why: "Ink pools into the paper and the joint gets weight, like the knuckle of a bamboo stalk or the corner of a character.",
  },
  tones: {
    name: "Ink has five colours", term: "墨分五色",
    how: "Dip in thick ink for the nearest, sharpest forms; thin it with water for what lies further away.",
    why: "With one black, painters build depth from the tones scorched, thick, heavy, light and clear (焦 濃 重 淡 清).",
  },
  brokenink: {
    name: "Broken ink", term: "破墨 pomo",
    how: "Lay a darker stroke into a paler one while it is still wet (or the reverse).",
    why: "The tones break into each other with soft, feathered borders. Japanese ink painters called the looser, splashed version haboku; Sesshū's landscapes are the famous examples.",
  },
  tarashikomi: {
    name: "Dripping in", term: "たらし込み tarashikomi",
    how: "Drop ink into a patch that is still wet and let the paper decide where it goes.",
    why: "The ink pools and dries with mottled, irregular edges. Painters of the Rinpa school (Sōtatsu, Kōrin, Hōitsu) used it for tree trunks, moss and rocks.",
  },
  hemp: {
    name: "Hemp-fibre strokes", term: "披麻皴 pima cun",
    how: "Long, soft, roughly parallel strokes with a moist centred tip, following the slope of a hill.",
    why: "They model rounded earthen hills. The manner descends from Dong Yuan and Juran (10th century) and was revived by Yuan literati such as Huang Gongwang.",
  },
  axe: {
    name: "Axe-cut strokes", term: "斧劈皴 fupi cun",
    how: "Short, fast, angular strokes with the side of the brush, as if chopping.",
    why: "They give rock faces hard, faceted planes. They belong to the Southern Song court painters Li Tang, Ma Yuan and Xia Gui.",
  },
  midots: {
    name: "Mi dots", term: "米點 Mi dian",
    how: "Lay the brush on its side and press horizontal dabs, wet into wet, darker over paler.",
    why: "Rows of soft dots build misty, rain-soaked hills, after the Song painters Mi Fu and his son Mi Youren.",
  },
  ironwire: {
    name: "Iron-wire line", term: "鐵線描 tiexian miao",
    how: "A thin, even line with a centred tip and steady speed, no swelling.",
    why: "Firm and elastic, it is the line of plain-line (baimiao, 白描) figure painting.",
  },
  orchidleaf: {
    name: "Orchid-leaf line", term: "蘭葉描 lanye miao",
    how: "Press and lift continuously so the line swells and tapers like a leaf.",
    why: "It gives drapery movement; tradition credits it to the Tang master Wu Daozi.",
  },
  nailrat: {
    name: "Nail-head, rat-tail", term: "釘頭鼠尾",
    how: "Enter with a short heavy press (the nail head), then lift and speed up into a long fading tail.",
    why: "The basic shape of orchid and bamboo leaves and of many drapery lines.",
  },
  boneless: {
    name: "Boneless", term: "沒骨 mogu",
    how: "Build the form from washes alone, without an outline.",
    why: "Softer, more atmospheric forms; Yun Shouping made it his signature for flowers.",
  },
  abbreviated: {
    name: "Abbreviated brush", term: "減筆 jianbi / genpitsu",
    how: "Say as much as possible with as few strokes as possible, quickly.",
    why: "The manner of Liang Kai and of Zen painters in China and Japan: a figure in a handful of strokes.",
  },
  enso: {
    name: "Circle", term: "円相 ensō",
    how: "One circle, in one breath, without going back.",
    why: "In Zen practice the circle is a portrait of the mind at that moment. Its unevenness is the point.",
  },
  arm: {
    name: "Suspended wrist", term: "懸腕 xuanwan",
    how: "Lift the wrist and elbow off the table; move from the shoulder.",
    why: "The whole arm, and the breath, drive the stroke, so long lines stay alive instead of stiffening at the wrist.",
  },
};

/** The eight principles of 永 (永字八法), in the order they appear. */
export const YONG = [
  { term: "側 ce", name: "Dot", text: "Like a stone falling from a high peak: press in at an angle, turn, lift." },
  { term: "勒 le", name: "Horizontal", text: "Like reining in a horse: the brush pulls against itself, rising slightly." },
  { term: "努 nu", name: "Vertical", text: "Like drawing a bow: straight, with tension, not stiffness." },
  { term: "趯 ti", name: "Hook", text: "Gather force at the bottom, then kick out quickly." },
  { term: "策 ce", name: "Rising", text: "Like a whip: a quick upward flick." },
  { term: "掠 lüe", name: "Long left-falling", text: "Sweep down to the left, the line thinning as the brush lifts." },
  { term: "啄 zhuo", name: "Short left-falling", text: "Like a bird pecking: short, fast, sharp." },
  { term: "磔 zhe", name: "Right-falling", text: "Begin light, press down into a broad belly, pause, then release to the right." },
];

export const PRINCIPLES = [
  { term: "氣韻生動", name: "Spirit resonance, life-motion",
    text: "The first of Xie He's six principles of painting (about 500 CE): the work should carry the living energy of what it shows and of the hand that made it." },
  { term: "骨法用筆", name: "Bone method in the use of the brush",
    text: "Xie He's second principle: structure comes from the brushstroke itself. A line should have bone." },
  { term: "胸有成竹", name: "The bamboo is complete in the chest",
    text: "Su Shi, describing his friend Wen Tong: have the whole bamboo in mind before the brush touches paper, then paint it at once." },
  { term: "石如飛白木如籀", name: "Rocks like flying white, trees like seal script",
    text: "Zhao Mengfu's inscription on his Elegant Rocks and Sparse Trees: painting and calligraphy share one brush. \"Painting bamboo, one must also master the eight methods\" of writing." },
];

export const TREASURES = {
  brush: "Animal hair (goat for soft, weasel for springy) set in bamboo. The hair holds a reservoir of ink, and its tip springs back.",
  ink: "Soot from burnt pine or oil, bound with animal glue and pressed into a stick. It is ground with water on the inkstone, so every session begins slowly, by hand.",
  stone: "The inkstone: a slab of fine stone with a well. Grinding takes minutes; painters treated it as time to settle the mind.",
  paper: "Raw xuan paper (宣紙) drinks ink at once, so a stroke cannot be corrected. Japanese washi, made from mulberry fibre, behaves similarly. Silk is usually sized with alum and glue, so lines stay crisp and washes can be layered.",
};

/** Holding the brush: the classical five-finger grip (五指執筆法). */
export const GRIP = {
  title: "Before you begin: holding the brush",
  steps: [
    "Hold the brush upright, perpendicular to the paper, a little above the middle of the handle.",
    "Five fingers each have a job (擫押鉤格抵): the thumb presses the handle from the inside; the index finger holds it from the outside; the middle finger hooks around it; the ring finger pushes back against it with the nail side; the little finger rests behind the ring finger and supports it.",
    "\"Fingers solid, palm hollow\" (指實掌虛): the fingers are firm, but the palm stays open, as if holding an egg in it.",
    "Lift the wrist off the paper and let the arm move from the shoulder; breathe out as the brush travels.",
    "With an Apple Pencil: hold it upright in the same grip and keep it light. Tilt it over only when you want the side of the brush.",
  ],
};

// ---------------------------------------------------------------- lessons
// The Mustard Seed Garden Manual of Painting (芥子園畫傳, first part 1679)
// taught painting stroke by stroke through set subjects. These follow that idea.
export const LESSONS = [
  {
    id: "yong", title: "Eight principles", subject: "永 (eternity)", tags: ["Calligraphy"], classification: "Calligraphy",
    techniques: ["concealed", "liftpress", "pause", "centred"],
    intro: "The character 永, \"eternity\", holds all eight basic movements of the brush: dot, horizontal, vertical, hook, rising, long and short left-falling, and the wave-like right-falling. Calligraphers have practised them for over a thousand years. Copy it stroke by stroke, in order.",
    demo: { kind: "yong" }, goal: {},
  },
  {
    id: "enso", title: "One breath", subject: "Ensō", tags: [], techniques: ["enso", "arm"],
    intro: "Before any subject, one circle. Breathe in. As you breathe out, draw the circle in one movement and do not go back.",
    demo: { kind: "circle" }, goal: { closed: true, minLength: 300 },
  },
  {
    id: "stalk", title: "Bamboo stalk", subject: "Bamboo", tags: ["Bamboo"], techniques: ["centred", "pause", "concealed"],
    intro: "Paint the stalk upward in sections. Each section is one stroke: press at the joint, travel up steadily with the brush upright, then pause and lift at the next joint.",
    demo: { kind: "stalk" }, goal: { direction: "up", pauses: true },
  },
  {
    id: "leaf", title: "Bamboo leaves", subject: "Bamboo", tags: ["Bamboo"], techniques: ["nailrat", "liftpress"],
    intro: "Each leaf is a single stroke: press in, then lift and flick out quickly. Group them in threes and fours like the characters 个 and 介.",
    demo: { kind: "leaf" }, goal: { taper: true, fast: true },
  },
  {
    id: "orchid", title: "Orchid leaf", subject: "Orchid", tags: ["Orchids", "Flowers", "Plants"], techniques: ["liftpress", "orchidleaf"],
    intro: "One long leaf in one stroke: thin, swelling, thin again as it turns. Cross a second leaf over it to make the \"phoenix eye\" (鳳眼), then break the eye with a third.",
    demo: { kind: "orchid" }, goal: { swell: true, minLength: 250 },
  },
  {
    id: "plum", title: "Plum branch", subject: "Plum", tags: ["Trees", "Flowers"], techniques: ["flyingwhite", "pause"],
    intro: "Old plum branches are dry and angular. Move with energy, change direction sharply and let the brush run dry so the bark shows flying white.",
    demo: { kind: "plum" }, goal: { turns: true, dry: true },
  },
  {
    id: "rock", title: "Rock", subject: "Rocks", tags: ["Landscapes", "Mountains"], techniques: ["side", "hemp", "axe"],
    intro: "Outline the rock with a few broken strokes, then texture its faces with the side of the brush. Tilt your Pencil, or use quick, broad finger strokes.",
    demo: { kind: "rock" }, goal: { side: true },
  },
];

// ---------------------------------------------------------------- feedback
/** A teacher's reading of one stroke's mechanics (from brush.js analyse()). */
export function readStroke(m, lesson = null) {
  if (!m || !m.length) return [];
  const notes = [];
  const pressArc = m.pressStart - m.pressMid;
  if (m.pressVar < 0.06) notes.push({ t: "liftpress", good: false, text: "The pressure stayed the same all the way. Let the hand rise and sink as it travels." });
  else notes.push({ t: "liftpress", good: true, text: "The line breathes: it thickens and thins with your pressure." });
  if (m.concealedEntry) notes.push({ t: "concealed", good: true, text: "You started against the stroke and turned back: a concealed entry." });
  if (m.tip > 0.45) notes.push({ t: "side", good: true, text: "Side tip: the belly of the brush did the work." });
  else if (m.tip < 0.12 && m.pen) notes.push({ t: "centred", good: true, text: "Upright brush: a centred tip." });
  if (m.load1 < 0.25 && m.speed > 0.8) notes.push({ t: "flyingwhite", good: true, text: "Fast and running dry: flying white." });
  if (m.pools > 12) notes.push({ t: "pause", good: true, text: "You paused and let the ink sink in." });
  if (m.speedVar < 0.25 && m.length > 120) notes.push({ t: "arm", good: false, text: "One even speed throughout. Try leaving the stroke slowly and finishing it fast, or the reverse." });
  if (pressArc > 0.12) notes.push({ t: "nailrat", good: true, text: "Heavy entry, lighter travel: the nail head of a leaf stroke." });
  if (lesson) {
    const g = lesson.goal || {};
    if (g.fast && m.speed < 0.45) notes.push({ t: "nailrat", good: false, text: "Leaves want speed: press, then flick out quickly." });
    if (g.swell && m.pressVar < 0.08) notes.push({ t: "orchidleaf", good: false, text: "Let the leaf swell in the middle and thin again at the end." });
    if (g.side && m.tip < 0.3 && m.pen) notes.push({ t: "side", good: false, text: "Tilt the Pencil further to bring the side of the brush down." });
    if (g.minLength && m.length < g.minLength) notes.push({ t: "arm", good: false, text: "Longer: move from the shoulder, not the fingers." });
  }
  return notes;
}

// ---------------------------------------------------------------- the works
const FORMAT = [
  [/handscroll/i, "Handscroll", "A handscroll (手卷) was never hung. A viewer unrolled it on a table, an arm's length at a time, from right to left, so the picture unfolds like a walk or a piece of music. Later owners often added their own inscriptions, colophons, at the end."],
  [/hanging scroll/i, "Hanging scroll", "A hanging scroll (掛軸) was hung on the wall for a season or an occasion, then rolled up again. In Japan it hung in the tokonoma alcove, changed with the time of year."],
  [/album|leaf|shikishi|shikisi/i, "Album leaf", "An album leaf was made to be held in the hands and seen closely, turned page by page in a small gathering."],
  [/fan/i, "Fan", "Painted on a folding fan, or on fan-shaped paper, then often mounted flat in an album; a gift carried and opened in company."],
  [/screen/i, "Folding screen", "A folding screen (屏風 byōbu) stood on the floor and was seen from a few steps away, its panels set in zigzags, so the composition moves in and out of the folds."],
  [/ten bamboo/i, "Painting manual", "A page of the Ten Bamboo Studio Manual of Calligraphy and Painting (十竹齋書畫譜, 1633), printed in Nanjing in many colour blocks, one per tone, so that a print could imitate the gradations of a brushstroke. It taught flowers, bamboo, rocks and fruit by example."],
  [/mustard seed/i, "Painting manual", "A page of the Mustard Seed Garden Manual of Painting (芥子園畫傳, first published 1679): a woodblock-printed course that taught painting stroke by stroke, subject by subject. Generations of painters in China and Japan learned from it, copying its models before ever painting from nature."],
  [/manga|sketchbook|gafu|manual/i, "Printed sketchbook", "A woodblock-printed book of brush drawings, cut by a carver from the artist's own drawings and printed for students and amateurs to copy."],
  [/sketch|drawing|study/i, "Sketch", "A working drawing: the painter's hand seen thinking."],
];

const SCHOOLS = [
  // [artist or period pattern, label, how the brush was used]
  [/Hokusai/i, "Hokusai and his studio", "Hokusai drew with a quick, even, calligraphic line, often in plain ink, from a lifetime of book illustration and drawing manuals."],
  [/Kyōsai|Kyosai/i, "Kawanabe Kyōsai", "Trained in the Kano school and also in popular painting, Kyōsai drew with dazzling speed: lively, exaggerated lines, wet and dry."],
  [/Kano|Tan'yū|Tanyu|Tsunenobu|Shōun|Yukinobu/i, "Kano school", "The Kano painters were official painters to the shogunate. Their brush is strong and disciplined: firm outlines, angular texture strokes taken from Chinese models, and confident ink washes."],
  [/Kōrin|Korin|Sōtatsu|Sotatsu|Hōitsu|Hoitsu|Kiitsu|Kōetsu|Koetsu/i, "Rinpa", "Rinpa painters favoured bold, decorative forms and the tarashikomi technique: ink dropped into wet ink to dry in soft, mottled pools."],
  [/Taiga|Buson|Bunchō|Buncho|Chikuden|Gyokudō|Gyokudo|Baiitsu|Chikutō|Chikuto|Hankō|Hanko|Chinzan/i, "Japanese literati (Nanga)", "Nanga painters took up the Chinese scholar-amateur ideal: dry, broken brushwork, dotting and texture strokes, poems written beside the picture."],
  [/Ōkyo|Okyo|Goshun|Rosetsu|Shijō|Shijo|Maruyama/i, "Maruyama–Shijō school", "Ōkyo's school looked closely at nature. Its signature brush (tsuketate) loads one side of the brush darker than the other, so a single stroke models a rounded form without outline."],
  [/Hakuin|Sengai|Ryōkan|Ryokan|Zen/i, "Zen ink", "Zen monks painted and wrote quickly, in a few strokes, as practice and teaching: the brushwork is direct and unpolished on purpose."],
  [/Sesshū|Sesshu|Sesson|Shūbun|Shubun/i, "Muromachi ink painting", "Japanese monk-painters of the Muromachi period learned from Chinese Song and Yuan ink painting: strong, angular outlines, axe-cut texture and wet, broken ink."],
  [/Jakuchū|Jakuchu|Shōhaku|Shohaku/i, "Eccentrics of Kyoto", "Individual, startling brushwork: Jakuchū's controlled, patterned ink; Shōhaku's wild, splashed strokes."],
  [/Shitao|Bada|Zhu Da/i, "Individualist", "Early Qing individualists broke the rules: Bada Shanren's few, wet, rounded strokes and empty space; Shitao's 'one stroke' (一畫) philosophy of brushwork."],
  [/Dong Qichang|Wang Hui|Wang Jian|Wang Shimin|Wang Yuanqi|Yun Shouping/i, "Orthodox school", "Late Ming and Qing painters who built landscapes from the brush manners of earlier masters, especially Yuan literati: dry hemp-fibre texture, dotting, layered tone."],
  [/Shen Zhou|Wen Zhengming|Tang Yin|Qiu Ying/i, "Wu school (Suzhou)", "Ming painters of Suzhou: literati brushwork, measured and calligraphic, with Shen Zhou's broad, blunt strokes and Wen Zhengming's fine, dry ones."],
  [/Ren Yi|Ren Bonian|Xugu|Zhao Zhiqian|Wu Changshuo/i, "Shanghai school", "Late Qing painters in commercial Shanghai: lively, wet, colourful brushwork with roots in calligraphy and seal carving."],
];

const PERIOD_NOTES = [
  [/Southern Song/i, "Southern Song court painting: misty, one-cornered compositions, axe-cut rocks, graded wet ink."],
  [/Northern Song|Song dynasty/i, "Song painting: monumental landscapes and close study of nature, built with layered texture strokes."],
  [/Yuan/i, "Yuan literati painting: dry brush, sparse compositions, painting as personal expression, often with poems."],
  [/Ming/i, "Ming painting: the court and Zhe schools' bold, wet brushwork, and the Wu school's calligraphic literati manner."],
  [/Qing/i, "Qing painting: orthodox masters recombining old brush manners, and individualists breaking them."],
  [/Muromachi|Nanbokuch/i, "Muromachi Japan: ink painting arrives with Zen, from Chinese Song and Yuan models."],
  [/Momoyama/i, "Momoyama Japan: bold, large-scale painting on gold, and powerful ink screens."],
  [/Edo/i, "Edo Japan: Kano, Rinpa, literati, Maruyama–Shijō and Zen painters all at work at once."],
  [/Meiji/i, "Meiji Japan: traditional brushwork meeting Western ideas of drawing and space."],
  [/Joseon/i, "Joseon Korea: literati ink, and painters like Jeong Seon painting real Korean scenery."],
  [/Kamakura|Heian/i, "Early Japanese painting: fine, even outlines, often for Buddhist images and narrative scrolls."],
];

export function describeWork(w, det = {}) {
  const medium = (w.medium || "").toLowerCase();
  const out = { format: null, formatText: "", school: null, schoolText: "", periodText: "", materialText: "" };
  for (const [re, label, text] of FORMAT) if (re.test(w.medium) || re.test(w.title)) { out.format = label; out.formatText = text; break; }
  for (const [re, label, text] of SCHOOLS) if (re.test(w.artist || "") || (label === "Zen ink" && /zen/i.test(w.title))) { out.school = label; out.schoolText = text; break; }
  const period = det.period || det.dynasty || "";
  for (const [re, text] of PERIOD_NOTES) if (re.test(period)) { out.periodText = text; break; }
  if (/silk|satin/.test(medium)) out.materialText = "On silk: the surface was sized, so lines stay sharp and washes can be built up in layers.";
  else if (/gold/.test(medium)) out.materialText = "On gold: ink sits on top of the metal and does not soak in, so strokes keep crisp, glossy edges.";
  else if (/paper/.test(medium)) out.materialText = "On paper: the ink soaked in at once, so every stroke stayed as it fell, without correction.";
  if (/color|colour/.test(medium)) out.materialText += " Colour was added in washes over or beside the ink.";
  out.period = period;
  return out;
}

// ---------------------------------------------------------------- brushwork from an ink map
/** Measure the brushwork in a square region of a work's ink map (the passage you met).
 *  ink: {W, H, data}, box: [x0, y0, x1, y1] in ink-map px. */
export function measurePassage(ink, box) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  const T = 90;
  let n = 0, inkN = 0, edges = 0, tones = [], runs = [];
  for (let y = Math.max(1, y0); y < Math.min(ink.H - 1, y1); y++) {
    let run = 0;
    for (let x = Math.max(1, x0); x < Math.min(ink.W - 1, x1); x++) {
      n++;
      const v = ink.data[y * ink.W + x];
      if (v > T) {
        inkN++; run++; tones.push(v);
        if (ink.data[y * ink.W + x + 1] <= T || ink.data[(y + 1) * ink.W + x] <= T) edges++;
      } else if (run) { runs.push(run); run = 0; }
    }
  }
  if (!n || inkN < 20) return null;
  tones.sort((a, b) => a - b);
  const q = (p) => tones[Math.floor((tones.length - 1) * p)];
  const mean = runs.reduce((a, b) => a + b, 0) / Math.max(1, runs.length);
  const sd = Math.sqrt(runs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, runs.length));
  const side = Math.max(1, x1 - x0);
  return {
    coverage: inkN / n,                       // how much of the passage is ink
    width: mean / side,                       // typical stroke width (fraction of passage)
    widthVar: sd / Math.max(1, mean),         // swelling and thinning
    toneRange: (q(0.9) - q(0.1)) / 255,       // spread of ink tones
    broken: edges / Math.max(1, inkN),        // ragged, dry, broken edges
  };
}

/** Words for a measured passage. */
export function brushWords(m) {
  if (!m) return [];
  const w = [];
  if (m.coverage > 0.32) w.push("dense, layered ink");
  else if (m.coverage < 0.07) w.push("sparse strokes with open paper");
  if (m.widthVar > 0.85) w.push("lines that swell and thin");
  else if (m.widthVar < 0.5 && m.width < 0.04) w.push("even, wiry lines");
  if (m.broken > 0.55) w.push("dry, broken edges (flying white, texture)");
  else if (m.broken < 0.3) w.push("wet, soft-edged ink");
  if (m.toneRange > 0.55) w.push("many tones of ink");
  else if (m.toneRange < 0.25) w.push("one even tone");
  return w;
}
