/* ─────────────────────────────────────────────────────────────
 *  PART 0 – Constants & Globals
 * ───────────────────────────────────────────────────────────── */
const MAX_CELLS = 75;
const COLOR_RE = /\\color\{#1682c9\}\{([\s\S]*?)\}/g;
let START_NUM, START_DEN, TARGET_DEN, FRACTION;
let CUR_NUM, CUR_DEN, CUR_FRAC;
let currentIndex = 0;
const pastStates = [];
currentIndex = 0;
let isCorrect = false;
let cfg = null, rowPreview = 0, colPreview = 0;
let colFactorConf = 1, rowFactorConf = 1;

// ── GROUPED SEQUENCE CONFIG ────────────────────────────────────
let groupOrder = ['mul', 'div', 'both'];
let groupTargets = { mul: 4, div: 4, both: 4 };        // 5 mul, 5 div, 5 both ⇒ total 15
let groupCorrect = { mul: 0, div: 0, both: 0 };
let currentGroup = 0;   // index into groupOrder
let groupQueue = { mul: [], div: [], both: [] };
const seenItems = new Set();
let modalEveryTime = false;

/* ─────────────────────────────────────────────────────────────
 *  PART 2  DOM hooks
 * ───────────────────────────────────────────────────────────── */

const fracDisp = document.getElementById('fraction-display');
const colDisp = document.getElementById('columns-display');
const rowDisp = document.getElementById('rows-display');
const colUpBtn = document.getElementById('columns-up');
const colDownBtn = document.getElementById('columns-down');
const rowUpBtn = document.getElementById('rows-up');
const rowDownBtn = document.getElementById('rows-down');
const baseGrid = document.getElementById('grid-1');
const overlay = document.getElementById('overlay-grid');
const histEntries = document.getElementById('history-entries');
const resetBtn = document.getElementById('reset-btn');
const readyBtn = document.getElementById('ready-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const modal = document.getElementById('answer-modal');
const input = document.getElementById('answer-input');
const submitBtn = document.getElementById('submit-answer');
const cancelBtn = document.getElementById('cancel-answer');
const feedback = document.getElementById('feedback-msg');

/* ─────────────────────────────────────────────────────────────
 *  PART 3  Helpers
 * ───────────────────────────────────────────────────────────── */

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function initReviewSequence() {
    // partition the bank
    const byG = { mul: [], div: [], both: [] };
    itemBank.forEach(it => byG[it.transform].push(it));

    // explicitly pick your first-two for mul & div
    const mulFirst = [
        byG.mul.find(it => it.num === 5 && it.den === 6 && it.targetDen === 12),
        byG.mul.find(it => it.num === 4 && it.den === 8 && it.targetDen === 24)
    ];
    const divFirst = [
        byG.div.find(it => it.num === 2 && it.den === 4 && it.targetDen === 2),
        byG.div.find(it => it.num === 18 && it.den === 27 && it.targetDen === 9)
    ];

    // remove those from the pools
    const mulRest = byG.mul.filter(it =>
        !mulFirst.includes(it)
    );
    const divRest = byG.div.filter(it =>
        !divFirst.includes(it)
    );

    // build each queue: first-two fixed, then shuffled rest
    groupQueue.mul = mulFirst.concat(shuffle(mulRest));
    groupQueue.div = divFirst.concat(shuffle(divRest));
    groupQueue.both = shuffle(byG.both);

    // reset counters & pointer
    groupCorrect = { mul: 0, div: 0, both: 0 };
    currentGroup = 0;
}

function showReviewCompleteModal() {
    const m = document.getElementById('review-complete-modal');
    m.classList.remove('hidden');
}

document.getElementById('go-learn').onclick = () => {
    window.location.href = 'learn.html';
};

document.getElementById('stay-review').onclick = () => {
    const modal = document.getElementById('review-complete-modal');
    modal.classList.add('hidden');

    if (!modalEveryTime) {
        // ① FIRST time: build & override queue, enable modalEveryTime
        modalEveryTime = true;

        const seenList = shuffle(itemBank.filter(it => seenItems.has(it)));
        const newList = shuffle(itemBank.filter(it => !seenItems.has(it)));
        const remaining = shuffle(itemBank.slice());

        if (remaining.length === 0) {
            alert("ทบทวนโจทย์ครบทุกข้อแล้ว");
            seenItems.clear();
            initReviewSequence();
            nextProblem();
            return;
        }

        // override queue just once
        groupOrder = ['remaining'];
        groupQueue = { remaining };
        groupTargets = { remaining: remaining.length };
        groupCorrect = { remaining: 0 };
        currentGroup = 0;

        // show the very first “remaining” problem
        nextProblem();

    } else {
        // ② subsequent times: just go to the next one
        nextProblem();
    }
};  

function safeTypeset(nodes) {
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
        return MathJax.typesetPromise(nodes).catch(console.error);
    }
    return Promise.resolve();
}

function findDimensions(D) {
    const out = [];
    for (let m = 1; m <= Math.sqrt(D); m++) if (D % m === 0) out.push([m, D / m]);
    return out;
}

function findRowsAndCols(dim, N) {          // choose rows × cols layout
    for (let i = dim.length - 1; i >= 0; i--) {
        const [r, c] = dim[i];
        if (N % r === 0) return { rows: r, cols: c, shadeBy: 'column' };
        if (N % c === 0) return { rows: c, cols: r, shadeBy: 'column' };
    }
    return null;
}

function validDivisors(dim, limit, mustDivideLimit) {
    const out = [];
    for (let d = 2; d <= dim; d++) {
        if (dim % d === 0 && (!mustDivideLimit || limit % d === 0)) out.push(d);
    }
    return out;
}

/* ─────────────────────────────────────────────────────────────
 *  PART 4  GRID BUILD & OVERLAY
 * ───────────────────────────────────────────────────────────── */

function buildBaseGrid(rows, cols) {
    // Clear previous cells
    baseGrid.innerHTML = '';
    const shadingGrid = document.getElementById('shading-grid');
    shadingGrid.innerHTML = '';

    // Set grid layout on both layers
    baseGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    baseGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    shadingGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    shadingGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    const shadedCells = Math.round(FRACTION * rows * cols);
    const limit = cfg.shadeBy === 'column'
        ? shadedCells / rows
        : shadedCells / cols;

    console.log(
        `shadedCells=${shadedCells}, rows=${rows}, cols=${cols}, limit=${limit}`
    );

    for (let i = 0; i < rows * cols; i++) {
        const r = Math.floor(i / cols), c = i % cols;

        const shadeCell = document.createElement('div');
        shadeCell.style.backgroundColor = (cfg.shadeBy === 'column' ? c < limit : r < limit)
            ? '#3498db' : 'transparent';
        shadeCell.style.margin = '0';
        shadeCell.style.padding = '0';
        shadeCell.style.border = 'none';
        shadeCell.style.boxSizing = 'border-box';
        shadeCell.style.width = '100%';
        shadeCell.style.height = '100%';
        shadingGrid.appendChild(shadeCell);

        const borderCell = document.createElement('div');
        borderCell.className = 'cell';
        baseGrid.appendChild(borderCell);

    }
}

function maskLines(isRow, divisor, hide) {
    const R = cfg.rows, C = cfg.cols, cells = baseGrid.children;

    if (isRow) {
        for (let r = 1; r < R; r++) {
            if (r % divisor !== 0) {
                const up = (r - 1) * C, lo = r * C;
                for (let c = 0; c < C; c++) {
                    cells[up + c].style.borderBottom = hide ? 'none' : '1px solid #000';
                    cells[lo + c].style.borderTop = hide ? 'none' : '1px solid #000';
                }
            }
        }
    } else {
        for (let r = 0; r < R; r++) {
            for (let c = 1; c < C; c++) {
                if (c % divisor !== 0) {
                    const right = r * C + c;
                    const left = r * C + c - 1;
                    cells[right].style.borderLeft = hide ? 'none' : '1px solid #000';
                    cells[left].style.borderRight = hide ? 'none' : '1px solid #000';
                }
            }
        }
    }
}

function rebuildOverlay() {
    /*  hide previously un-masked borders */
    maskLines(false, Math.abs(colPreview), false);
    maskLines(true, Math.abs(rowPreview), false);

    /*  if nothing to preview, just hide and return  */
    if (rowPreview === 0 && colPreview === 0) {
        overlay.style.display = 'none';
        updateButtonStates();
        return;
    }

    /*  grid size for overlay */
    const rows = rowPreview > 0 ? cfg.rows * rowPreview : cfg.rows;
    const cols = colPreview > 0 ? cfg.cols * colPreview : cfg.cols;

    overlay.style.gridTemplate = `repeat(${rows},1fr)/repeat(${cols},1fr)`;
    overlay.innerHTML = '';

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'overlay-cell';

            /*  dashed horizontal lines for row “split”  */
            if (rowPreview > 1 && r % rowPreview !== 0)
                cell.style.borderTop = '1px dashed #ccc';

            /*  dashed vertical lines for col “split”  */
            if (colPreview > 1 && c % colPreview !== 0)
                cell.style.borderLeft = '1px dashed #ccc';

            /*  dashed lines for row “merge”  */
            if (rowPreview < -1 && r % (-rowPreview) !== 0 && r !== 0)
                cell.style.borderTop = '1px dashed #ccc';

            /*  dashed lines for col “merge”  */
            if (colPreview < -1 && c % (-colPreview) !== 0 && c !== 0)
                cell.style.borderLeft = '1px dashed #ccc';

            overlay.appendChild(cell);
        }
    }

    overlay.style.display = 'grid';

    /*  hide solid borders only for “merge” previews  */
    if (colPreview < -1) maskLines(false, -colPreview, true);
    if (rowPreview < -1) maskLines(true, -rowPreview, true);

    updateButtonStates();
    updatePermanentPreview();
}

/* ─────────────────────────────────────────────────────────────
 *  PART 5  UI Updates
 * ───────────────────────────────────────────────────────────── */

function updateButtonStates() {
    //
    // ── COLUMN UP (× preview or cancel merge) ──
    //
    if (colPreview < 0) {
        // in a divide preview → ▲ should *always* cancel back to frozen
        colUpBtn.disabled = false;
    } else {
        // either no preview (start ×2) or a × preview (×(n+1))
        const nextFactor = colPreview > 0 ? colPreview + 1 : 2;
        colUpBtn.disabled = (cfg.cols * nextFactor > MAX_CELLS);
    }

    //
    // ── COLUMN DOWN (÷ preview) ──
    //
    // find all valid divisors for the *current* frozen cols
    const shadedCols = cfg.shadeBy === 'column'
        ? (FRACTION * cfg.rows * cfg.cols) / cfg.rows
        : null;
    const colDivs = validDivisors(cfg.cols, shadedCols, cfg.shadeBy === 'column');

    if (colPreview > 0) {
        // in a × preview → ▼ should *always* rewind that ×
        colDownBtn.disabled = false;
    } else if (colPreview === 0) {
        // no preview → ▼ starts the first divide if any
        colDownBtn.disabled = (colDivs.length === 0);
    } else {
        // in a ÷ preview (e.g. colPreview = -3 or -9) → disable only if at the *smallest* divisor
        const idx = colDivs.indexOf(-colPreview);
        colDownBtn.disabled = (idx === colDivs.length - 1);
    }

    //
    // ── ROW UP / DOWN ──  (exact same logic on rows)
    //
    if (rowPreview < 0) {
        rowUpBtn.disabled = false;
    } else {
        const nextFactor = rowPreview > 0 ? rowPreview + 1 : 2;
        rowUpBtn.disabled = (cfg.rows * nextFactor > MAX_CELLS);
    }

    const shadedRows = cfg.shadeBy === 'row'
        ? (FRACTION * cfg.rows * cfg.cols) / cfg.cols
        : null;
    const rowDivs = validDivisors(cfg.rows, shadedRows, cfg.shadeBy === 'row');

    if (rowPreview > 0) {
        rowDownBtn.disabled = false;
    } else if (rowPreview === 0) {
        rowDownBtn.disabled = (rowDivs.length === 0);
    } else {
        const idx = rowDivs.indexOf(-rowPreview);
        rowDownBtn.disabled = (idx === rowDivs.length - 1);
    }

    if (colPreview !== 0) {
        rowUpBtn.disabled = true;
        rowDownBtn.disabled = true;
    }
    // likewise, if there’s a row preview active, lock out columns:
    if (rowPreview !== 0) {
        colUpBtn.disabled = true;
        colDownBtn.disabled = true;
    }
    updatePermanentPreview();
}

function setColDisplay(factor) {
    if (factor === 1) {
        colDisp.innerHTML = cfg.cols;                 // plain number
    } else {
        colDisp.innerHTML =
            `${cfg.cols} <span class="factor">× ${factor}</span>`;
    }
}

function setRowDisplay(factor) {
    if (factor === 1) {
        rowDisp.innerHTML = cfg.rows;
    } else {
        rowDisp.innerHTML =
            `${cfg.rows} <span class="factor">× ${factor}</span>`;
    }
}

function setColDisplayDiv(divisor) {
    if (divisor === 1) { colDisp.innerHTML = cfg.cols; }
    else {
        colDisp.innerHTML =
            `${cfg.cols} <span class="factor">÷ ${divisor}</span>`;
    }
}
function setRowDisplayDiv(divisor) {
    if (divisor === 1) { rowDisp.innerHTML = cfg.rows; }
    else {
        rowDisp.innerHTML =
            `${cfg.rows} <span class="factor">÷ ${divisor}</span>`;
    }
}

/* ─────────────────────────────────────────────────────────────
 *  PART 6  HISTORY & HIGHLIGHT
 * ───────────────────────────────────────────────────────────── */

function getPreviewInfo() {
    if (colPreview > 1) return { axis: 'col', factor: colPreview };
    else if (colPreview < -1) return { axis: 'col', factor: 1 / (-colPreview) };
    else if (rowPreview > 1) return { axis: 'row', factor: rowPreview };
    else if (rowPreview < -1) return { axis: 'row', factor: 1 / (-rowPreview) };
    else return null;
}

function updatePermanentPreview() {
    const mathSpan = document.getElementById('preview-math');
    const controlsDiv = document.getElementById('preview-controls');
    const info = getPreviewInfo();
    if (!info) {
        mathSpan.innerHTML = '';
        controlsDiv.innerHTML = '';
        return;
    }

    // 1) compute state
    const { axis, factor } = info;
    const op = axis === 'col'
        ? (factor === colPreview ? '×' : '÷')
        : (factor === rowPreview ? '×' : '÷');

    const oldNum = CUR_NUM;
    const oldDen = CUR_DEN;

    // newNum/newDen *are* the answers, even in divide cases:
    const newNum = oldNum * factor;
    const newDen = oldDen * factor;

    // how we label the “÷” in red:
    const displayFactor = op === '×'
        ? factor
        : (axis === 'col' ? -colPreview : -rowPreview);

    // 2) render the two preview fractions (with both “=” signs)
    mathSpan.innerHTML = `
    <span class="preview-fraction">\\(\\frac{${oldNum}}{${oldDen}}\\)</span>
    <span class="preview-eq">=</span>
    <span class="preview-fraction">
      \\(\\frac{${oldNum}\\,{\\color{red}${op}\\,${displayFactor}}}
           {${oldDen}\\,{\\color{red}${op}\\,${displayFactor}}}\\)
    </span>
    <span class="preview-eq">=</span>
  `;
    MathJax.typesetPromise([mathSpan]).catch(console.error);

    // 3) render the inputs + button
    controlsDiv.innerHTML = `
  <span class="preview-inputs">
    <input
      id="preview-numerator"
      type="text"
      inputmode="numeric"
      maxlength="4"
      style="text-align:center;"
      oninput="
        // 1) remove non-digits
        this.value = this.value.replace(/[^0-9]/g, '') 
          // 2) strip leading zeroes
          .replace(/^0+/, '') 
          // 3) clamp to 4 chars
          .slice(0, 4);
      "
    />
    <div class="fraction-bar"></div>
    <input
      id="preview-denominator"
      type="text"
      inputmode="numeric"
      maxlength="4"
      style="text-align:center;"
      oninput="
        this.value = this.value.replace(/[^0-9]/g, '')
          .replace(/^0+/, '')
          .slice(0, 4);
      "
    />
  </span>
  <button id="preview-confirm">ตกลง</button>
`;

    // 4) strict validation against newNum/newDen
    const numInput = controlsDiv.querySelector('#preview-numerator');
    const denInput = controlsDiv.querySelector('#preview-denominator');
    const btn = controlsDiv.querySelector('#preview-confirm');

    btn.onclick = () => {
        const nv = parseFloat(numInput.value);
        const dv = parseFloat(denInput.value);

        if (nv === newNum && dv === newDen) {
            // correct → commit as before
            if (colPreview !== 0) confirmCols();
            else confirmRows();
        } else {
            // wrong → show alert, then re-focus
            showAlert(`❌ ยังไม่ถูกต้อง ลองอีกครั้ง`);
            numInput.focus();
        }
    };
}

function logHistory(oldRows, oldCols, newRows, newCols) {
    if (oldRows === newRows && oldCols === newCols) return;

    // compute old/new values
    const oldDen = oldRows * oldCols;
    const newDen = newRows * newCols;
    const oldNum = FRACTION * oldDen;
    const newNum = FRACTION * newDen;

    // pick operation and factor
    let op, factor;
    const colFactor = newCols / oldCols;
    const rowFactor = newRows / oldRows;
    if (colFactor !== 1) {
        if (colFactor > 1) { op = '×'; factor = colFactor; }
        else { op = '÷'; factor = oldCols / newCols; }
    } else if (rowFactor !== 1) {
        if (rowFactor > 1) { op = '×'; factor = rowFactor; }
        else { op = '÷'; factor = oldRows / newRows; }
    } else {
        return;
    }

    // 1️⃣ create the step container
    const step = document.createElement('div');
    step.className = 'step';

    // 2️⃣ inject plain TeX—no \color wrappers!
    step.innerHTML =
        `$$
      \\frac{${oldNum}}{${oldDen}} =
      \\frac{${oldNum}\\,${op}\\,${factor}}
           {${oldDen}\\,${op}\\,${factor}} =
      \\frac{${newNum}}{${newDen}}
    $$`;

    // 3️⃣ append and typeset
    histEntries.appendChild(step);
    if (MathJax.typesetPromise) MathJax.typesetPromise([step]).catch(console.error);

    // 4️⃣ scroll into view
    histEntries.scrollTop = histEntries.scrollHeight;
}

function renderProblemLine(state, isActive) {
    const left = `\\frac{${state.num}}{${state.den}}`;
    const right = `\\frac{\\Box}{${TARGET_DEN}}`;

    if (isActive) {
        // wrap color+frac in its own {…} group
        return `\\(
        {\\color{#1682c9}${left}}
        = 
        ${right}
      \\)`;
    } else {
        return `\\(${left} = ${right}\\)`;
    }
}

function renderStep(state, isActive) {
    // state has { oldNum, oldDen, op, factor, newNum, newDen }
    const left = `\\frac{${state.oldNum}}{${state.oldDen}}`;
    const mid = `\\frac{${state.oldNum}\\,${state.op}\\,${state.factor}}
                   {${state.oldDen}\\,${state.op}\\,${state.factor}}`;
    const right = isActive
        ? `\\color{#1682c9}{\\frac{${state.newNum}}{${state.newDen}}}`
        : `\\frac{${state.newNum}}{${state.newDen}}`;

    return `\\[${left} = ${mid} = ${right}\\]`;
}


function repaintHighlight() {
    // 1️⃣ top problem‐line
    const probState = pastStates[0];
    fracDisp.innerHTML = renderProblemLine(probState, currentIndex === 0);

    // 2️⃣ clear & rebuild history
    // 2️⃣ clear & rebuild history (only up to currentIndex)
    histEntries.innerHTML = '';
    // slice from 1 up to currentIndex inclusive:
    pastStates.slice(1, currentIndex + 1).forEach((st, i) => {
        const idx = i + 1;
        const div = document.createElement('div');
        div.className = 'step';
        div.innerHTML = renderStep(st, idx === currentIndex);
        histEntries.appendChild(div);
    });

    // 3️⃣ typeset all at once
    safeTypeset();
}

/* ─────────────────────────────────────────────────────────────
   PART 7 – MODALS & ANSWERS
───────────────────────────────────────────────────────────── */

function askForNumerator() {
    const modal = document.getElementById('answer-modal');
    const feedback = document.getElementById('feedback-msg');
    const rightFraction = document.getElementById('right-fraction');
    const submitBtn = document.getElementById('submit-answer');
    const cancelBtn = document.getElementById('cancel-answer');

    rightFraction.innerHTML = '';
    feedback.classList.add('hidden');
    submitBtn.onclick = null;

    const expected = START_NUM * (TARGET_DEN / START_DEN);
    document.getElementById('left-num').textContent = START_NUM;
    document.getElementById('left-den').textContent = START_DEN;

    if (isCorrect) {
        rightFraction.innerHTML = renderFractionStaticOnly(expected);

        feedback.textContent = '✅ ถูกต้อง!';
        feedback.style.color = 'green';
        feedback.classList.remove('hidden');

        submitBtn.textContent = 'ไปข้อต่อไป';
        submitBtn.onclick = () => {
            modal.classList.add('hidden');
            handleCorrectAnswer();
        };

    } else {
        rightFraction.innerHTML = renderFractionInputOnly();

        const input = document.getElementById('answer-input');
        input.value = '';
        input.focus();

        submitBtn.textContent = 'ตกลง';
        submitBtn.onclick = () => {
            const val = parseInt(input.value.trim(), 10);
            const isValid = /^[0-9]+$/.test(input.value.trim());
            if (isValid && val === expected) {
                isCorrect = true;
                disableGridControls();

                feedback.textContent = '✅ ถูกต้อง!';
                feedback.style.color = 'green';
                feedback.classList.remove('hidden');

                askForNumerator();
            } else {
                feedback.textContent = '❌ ยังไม่ถูก ลองใหม่';
                feedback.style.color = 'red';
                feedback.classList.remove('hidden');
                input.focus();
            }
        };
    }

    cancelBtn.onclick = () => {
        modal.classList.add('hidden');
    };

    modal.classList.remove('hidden');
}

function readyToFill() {
    if (cfg.rows * cfg.cols === TARGET_DEN) {
        askForNumerator();
    } else {
        showAlert(`ตัวส่วนยังไม่เป็น ${TARGET_DEN}`);
    }
}

function showAlert(msg) {
    const modal = document.getElementById('alert-modal');
    const text = document.getElementById('alert-text');
    const ok = document.getElementById('alert-ok');

    text.textContent = msg;
    modal.classList.remove('hidden');

    const cleanup = () => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', cleanup);
    };

    ok.addEventListener('click', cleanup);
}

function handleCorrectAnswer() {
    const grp = groupOrder[currentGroup];
    groupCorrect[grp]++;

    if (groupCorrect[grp] >= groupTargets[grp]) {
        currentGroup++;
    }

    if (currentGroup >= groupOrder.length) {
        showReviewCompleteModal();
        return;
    }

    if (modalEveryTime) {
        showReviewCompleteModal();
        return;
    }

    nextProblem();
}

/* ─────────────────────────────────────────────────────────────
 *  PART 8  PREVIEW CONFIRM
 * ───────────────────────────────────────────────────────────── */

/* commit previews and reset them */
function confirmCols() {
    if (!colPreview) return;

    // 0️⃣ stash old state
    const oldRows = cfg.rows, oldCols = cfg.cols;
    const oldNum = CUR_NUM, oldDen = CUR_DEN;

    // 1️⃣ compute factor
    const factor = colPreview > 1
        ? colPreview
        : 1 / (-colPreview);

    // 2️⃣ apply it
    cfg.cols *= factor;
    CUR_NUM *= factor;
    CUR_DEN *= factor;
    CUR_FRAC = CUR_NUM / CUR_DEN;

    // 3️⃣ reset preview & rebuild
    colPreview = 0;
    buildBaseGrid(cfg.rows, cfg.cols);
    rebuildOverlay();
    updateButtonStates();
    setColDisplay(1);

    // 4️⃣ record structured step
    //    for a ÷ step, we want the human‐readable divisor oldCols/cfg.cols
    const humanFactor = factor > 1
        ? factor
        : (oldCols / cfg.cols);

    pastStates.length = currentIndex + 1;
    pastStates.push({
        oldNum,
        oldDen,
        op: factor > 1 ? '×' : '÷',
        factor: humanFactor,
        newNum: CUR_NUM,
        newDen: CUR_DEN,
        rows: cfg.rows,
        cols: cfg.cols,
        shadeBy: cfg.shadeBy
    });
    currentIndex = pastStates.length - 1;

    enableUndo();
    repaintHighlight();
}

function confirmRows() {
    if (!rowPreview) return;

    // 0️⃣ stash old state
    const oldRows = cfg.rows, oldCols = cfg.cols;
    const oldNum = CUR_NUM, oldDen = CUR_DEN;

    // 1️⃣ compute factor
    const factor = rowPreview > 1
        ? rowPreview
        : 1 / (-rowPreview);

    // 2️⃣ apply it
    cfg.rows *= factor;
    CUR_NUM *= factor;
    CUR_DEN *= factor;
    CUR_FRAC = CUR_NUM / CUR_DEN;

    // 3️⃣ reset preview & rebuild
    rowPreview = 0;
    buildBaseGrid(cfg.rows, cfg.cols);
    rebuildOverlay();
    updateButtonStates();
    setRowDisplay(1);

    // 4️⃣ record structured step
    const humanFactor = factor > 1
        ? factor
        : (oldRows / cfg.rows);

    pastStates.length = currentIndex + 1;
    pastStates.push({
        oldNum,
        oldDen,
        op: factor > 1 ? '×' : '÷',
        factor: humanFactor,
        newNum: CUR_NUM,
        newDen: CUR_DEN,
        rows: cfg.rows,
        cols: cfg.cols,
        shadeBy: cfg.shadeBy
    });
    currentIndex = pastStates.length - 1;

    enableUndo();
    repaintHighlight();
}

/* ─────────────────────────────────────────────────────────────
 *  PART 9  BUTTON HANDLERS
 * ───────────────────────────────────────────────────────────── */

/* ▲ UP  */
/* ▲  COLUMN  UP  ─────────────────────────────────────────────── */
function columnUp() {
    /* 1 ── still in ×-preview → just increase factor   (unchanged) */
    if (colPreview > 0) {
        colPreview++;
        rebuildOverlay();
        setColDisplay(colPreview);
        return;
    }

    /* 2 ── in ÷-preview → move to the previous (smaller) divisor */
    if (colPreview < 0) {
        /* un-mask the lines hidden by the CURRENT divisor */
        maskLines(false, -colPreview, false);

        const shaded = cfg.shadeBy === 'column'
            ? FRACTION * cfg.rows * cfg.cols / cfg.rows
            : null;
        const divs = validDivisors(cfg.cols, shaded, cfg.shadeBy === 'column'); // ascending
        const idx = divs.indexOf(-colPreview);  // 0,1,2…

        if (idx > 0) {                           // step back to previous divisor
            colPreview = -divs[idx - 1];
            rebuildOverlay();
            setColDisplayDiv(-colPreview);
            return;
        } else {                                 // already at smallest divisor → cancel
            colPreview = 0;
            rebuildOverlay();
            setColDisplay(1);
            return;
        }
    }

    /* 3 ── no preview → start ×2 as before */
    colPreview = 2;
    rebuildOverlay();
    setColDisplay(colPreview);
}

/* ▲  ROW  UP  ────────────────────────────────────────────────── */
function rowUp() {
    if (rowPreview > 0) {        /* grow ×-preview */
        rowPreview++;
        rebuildOverlay();
        setRowDisplay(rowPreview);
        return;
    }

    if (rowPreview < 0) {        /* step back through divisors */
        maskLines(true, -rowPreview, false);

        const shaded = cfg.shadeBy === 'row'
            ? FRACTION * cfg.rows * cfg.cols / cfg.cols
            : null;
        const divs = validDivisors(cfg.rows, shaded, cfg.shadeBy === 'row');
        const idx = divs.indexOf(-rowPreview);

        if (idx > 0) {           // go to previous divisor
            rowPreview = -divs[idx - 1];
            rebuildOverlay();
            setRowDisplayDiv(-rowPreview);
            return;
        } else {                 // already at smallest → cancel
            rowPreview = 0;
            rebuildOverlay();
            setRowDisplay(1);
            return;
        }
    }

    /* no preview → begin ×2 */
    rowPreview = 2;
    rebuildOverlay();
    setRowDisplay(rowPreview);
}

/* ▼  COLUMN  DOWN  (no wrap, no accidental clear) */
function columnDown() {
    /* 1 ── rewind × previews */
    if (colPreview > 2) {
        colPreview--;
        rebuildOverlay();
        setColDisplay(colPreview);
        return;
    }
    if (colPreview === 2) {
        colPreview = 0;
        rebuildOverlay();
        setColDisplay(1);
        return;
    }

    /* 2 ── decide next divisor (if any) */
    const shaded = cfg.shadeBy === 'column'
        ? FRACTION * cfg.rows * cfg.cols / cfg.rows
        : null;
    const divs = validDivisors(cfg.cols, shaded, cfg.shadeBy === 'column'); // ascending
    if (!divs.length) return;

    const idx = divs.indexOf(-colPreview);                 // −1, 0, 1, …
    if (idx === divs.length - 1) return;                   // already at smallest ⇒ stop

    const nextPreview = idx === -1 ? -divs[0] : -divs[idx + 1];

    /* 3 ── change preview safely */
    if (colPreview < -1) maskLines(false, -colPreview, false);  // un-mask old merge lines
    colPreview = nextPreview;
    rebuildOverlay();
    setColDisplayDiv(-colPreview);
}

/* ▼  ROW  DOWN  (mirrors column logic) */
function rowDown() {
    /* 1 ── rewind × previews */
    if (rowPreview > 2) {
        rowPreview--;
        rebuildOverlay();
        setRowDisplay(rowPreview);
        return;
    }
    if (rowPreview === 2) {
        rowPreview = 0;
        rebuildOverlay();
        setRowDisplay(1);
        return;
    }

    /* 2 ── decide next divisor */
    const shaded = cfg.shadeBy === 'row'
        ? FRACTION * cfg.rows * cfg.cols / cfg.cols
        : null;
    const divs = validDivisors(cfg.rows, shaded, cfg.shadeBy === 'row');
    if (!divs.length) return;

    const idx = divs.indexOf(-rowPreview);
    if (idx === divs.length - 1) return;                    // smallest divisor reached

    const nextPreview = idx === -1 ? -divs[0] : -divs[idx + 1];

    /* 3 ── change preview safely */
    if (rowPreview < -1) maskLines(true, -rowPreview, false);
    rowPreview = nextPreview;
    rebuildOverlay();
    setRowDisplayDiv(-rowPreview);
}

function handleUndo() {
    if (currentIndex === 0) return;
    currentIndex--;
    restoreState(pastStates[currentIndex]);
}

function handleRedo() {
    if (currentIndex >= pastStates.length - 1) return;
    currentIndex++;
    restoreState(pastStates[currentIndex]);
}

function handleUndo() {
    if (currentIndex === 0) return;
    currentIndex--;
    restoreState(pastStates[currentIndex]);
}

function handleRedo() {
    if (currentIndex >= pastStates.length - 1) return;
    currentIndex++;
    restoreState(pastStates[currentIndex]);
}

function restoreState(s) {
    // ── 1) CLEAR ANY PENDING PREVIEW ───────────────────────────
    colPreview = 0;
    rowPreview = 0;

    // hide the dashed overlay grid entirely
    overlay.style.display = 'none';

    // clear out the equation preview & confirm controls
    document.getElementById('preview-math').innerHTML = '';
    document.getElementById('preview-controls').innerHTML = '';

    // reset the top/left scale displays back to the “1×” state
    setColDisplay(1);
    setRowDisplay(1);

    // ── 2) RESTORE FROZEN STATE ───────────────────────────────
    cfg.rows = s.rows;
    cfg.cols = s.cols;
    cfg.shadeBy = s.shadeBy;
    CUR_NUM = s.num !== undefined ? s.num : s.newNum;
    CUR_DEN = s.den !== undefined ? s.den : s.newDen;

    // rebuild the base grid & re-lock buttons as needed
    buildBaseGrid(cfg.rows, cfg.cols);
    updateButtonStates();

    // re-enable/disable undo & redo
    undoBtn.disabled = (currentIndex === 0);
    redoBtn.disabled = (currentIndex >= pastStates.length - 1);

    // repaint the history + highlight currentIndex
    repaintHighlight();
}

function enableUndo() {
    undoBtn.disabled = false;
}

function disableGridControls() {
    colUpBtn.disabled = true;
    colDownBtn.disabled = true;
    rowUpBtn.disabled = true;
    rowDownBtn.disabled = true;
}

/* ─────────────────────────────────────────────────────────────
 *  PART 10  PROBLEM LIFECYCLE
 * ───────────────────────────────────────────────────────────── */

function nextProblem() {
    const grp = groupOrder[currentGroup];
    // if the queue ever runs dry, that means the user has exhausted
    // even the “random” pool—just reshuffle the remainder:
    if (!groupQueue[grp].length) {
        groupQueue[grp] = shuffle(
            itemBank.filter(it => it.transform === grp)
        );
    }
    const item = groupQueue[grp].shift();

    // mark it as seen
    seenItems.add(item);

    // now exactly the same as your old loadNewProblem:
    START_NUM = item.num;
    START_DEN = item.den;
    TARGET_DEN = item.targetDen;
    FRACTION = START_NUM / START_DEN;
    isCorrect = false;

    CUR_NUM = START_NUM; CUR_DEN = START_DEN; CUR_FRAC = CUR_NUM / CUR_DEN;

    histEntries.innerHTML = '';
    pastStates.length = 0;
    currentIndex = 0;

    cfg = findRowsAndCols(findDimensions(START_DEN), START_NUM);
    buildBaseGrid(cfg.rows, cfg.cols);
    setColDisplay(1);
    setRowDisplay(1);
    overlay.style.display = 'none';
    updateButtonStates();

    fracDisp.innerHTML = `\\(\\frac{${START_NUM}}{${START_DEN}} = \\frac{\\Box}{${TARGET_DEN}}\\)`;
    safeTypeset().then(() => {
        pastStates.push({
            rows: cfg.rows, cols: cfg.cols, shadeBy: cfg.shadeBy,
            num: START_NUM, den: START_DEN
        });
        currentIndex = 0;
        repaintHighlight();
    });
}

function loadNewProblem() {
    const item = itemBank[Math.floor(Math.random() * itemBank.length)];
    START_NUM = item.num;
    START_DEN = item.den;
    TARGET_DEN = item.targetDen;
    FRACTION = START_NUM / START_DEN;
    isCorrect = false;

    CUR_NUM = START_NUM;
    CUR_DEN = START_DEN;
    CUR_FRAC = CUR_NUM / CUR_DEN;

    // clear history and state
    histEntries.innerHTML = '';
    pastStates.length = 0;
    currentIndex = 0;

    // rebuild grid
    cfg = findRowsAndCols(findDimensions(START_DEN), START_NUM);
    buildBaseGrid(cfg.rows, cfg.cols);
    setColDisplay(1);
    setRowDisplay(1);
    overlay.style.display = 'none';

    // re-enable controls
    colUpBtn.disabled = rowUpBtn.disabled =
        colDownBtn.disabled = rowDownBtn.disabled = false;
    updateButtonStates();

    // inject the *plain* TeX (no \color!)
    fracDisp.innerHTML =
        `\\(\\frac{${START_NUM}}{${START_DEN}} = \\frac{\\Box}{${TARGET_DEN}}\\)`;

    // **remove** any old highlight class:
    fracDisp.classList.remove('highlight');

    // finally typeset
    safeTypeset().then(() => {
        pastStates.length = 0;
        pastStates.push({
            rows: cfg.rows,
            cols: cfg.cols,
            shadeBy: cfg.shadeBy,
            num: START_NUM,
            den: START_DEN
        });
        currentIndex = 0;
    });
}

function resetProblem() {
    // 0) **Clear any pending preview state & UI**
    colPreview = 0;
    rowPreview = 0;
    // wipe out the little preview fractions/inputs
    document.getElementById('preview-math').innerHTML = '';
    document.getElementById('preview-controls').innerHTML = '';

    // 1) Restore the “current” fraction variables back to the start
    CUR_NUM = START_NUM;
    CUR_DEN = START_DEN;
    CUR_FRAC = CUR_NUM / CUR_DEN;

    // 2) Recompute the initial grid config and rebuild the UI
    cfg = findRowsAndCols(findDimensions(START_DEN), START_NUM);
    buildBaseGrid(cfg.rows, cfg.cols);
    setColDisplay(1);
    setRowDisplay(1);
    overlay.style.display = 'none';

    // 3) Re-enable all grid controls
    colUpBtn.disabled = colDownBtn.disabled = rowUpBtn.disabled = rowDownBtn.disabled = false;

    // 4) Re-inject the blue “start” fraction
    fracDisp.innerHTML =
        `\\( {\\color{#1682c9}\\frac{${START_NUM}}{${START_DEN}}} = \\frac{\\Box}{${TARGET_DEN}} \\)`;

    // 5) Re-typeset and then clear & seed history & repaint
    safeTypeset().then(() => {
        // a) clear history pane
        histEntries.innerHTML = '';

        // b) reset history array to just the initial state
        pastStates.length = 0;
        pastStates.push({
            rows: cfg.rows,
            cols: cfg.cols,
            shadeBy: cfg.shadeBy,
            num: START_NUM,
            den: START_DEN
        });
        currentIndex = 0;

        // c) disable undo/redo until a move is made
        undoBtn.disabled = true;
        redoBtn.disabled = true;

        // d) update controls & repaint the highlighted step
        updateButtonStates();
        repaintHighlight();
    });
}

function renderFractionInputOnly() {
    return `
        <input 
            type="text" 
            id="answer-input" 
            class="numerator-input" 
            inputmode="numeric"
            oninput="this.value = this.value.replace(/[^0-9]/g, '')"
            style="width:40px; text-align: center;"
        />
        <div class="fraction-bar"></div>
        <div class="denominator">${TARGET_DEN}</div>
    `;
}

function renderFractionStaticOnly(numerator) {
    return `
        <div class="numerator">${numerator}</div>
        <div class="fraction-bar"></div>
        <div class="denominator">${TARGET_DEN}</div>
    `;
}

/* ─────────────────────────────────────────────────────────────
 *  PART 10  Initialisation
 * ───────────────────────────────────────────────────────────── */
(function init() {
    // 0) Fetch the bank of items first
    fetch('review-items.json')
        .then(res => res.json())
        .then(data => {
            // 1) Make it globally available
            window.itemBank = data;

            // 2) Now that itemBank exists, initialize your review sequence
            initReviewSequence();
            nextProblem();

            // 3) Set up the static displays
            setColDisplay(1);
            setRowDisplay(1);

            // 4) Wire up all your buttons
            colUpBtn.addEventListener('click', columnUp);
            colDownBtn.addEventListener('click', columnDown);
            rowUpBtn.addEventListener('click', rowUp);
            rowDownBtn.addEventListener('click', rowDown);
            resetBtn.addEventListener('click', resetProblem);
            readyBtn.addEventListener('click', readyToFill);
            undoBtn.addEventListener('click', handleUndo);
            redoBtn.addEventListener('click', handleRedo);

            // 5) Capture the initial TeX & seed history
            safeTypeset().then(() => {
                pastStates.push({
                    rows: cfg.rows,
                    cols: cfg.cols,
                    shadeBy: cfg.shadeBy,
                    num: START_NUM,
                    den: START_DEN
                });
                currentIndex = 0;
                repaintHighlight();
            });

            // 6) Disable undo/redo until first move
            undoBtn.disabled = true;
            redoBtn.disabled = true;

            // 7) Final button‐state sync
            updateButtonStates();
        })
        .catch(err => {
            console.error('Failed to load itemBank.json:', err);
            alert('Could not load problem bank. Please try again later.');
        });
})();