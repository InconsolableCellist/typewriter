// The pages of our quick-start packet on the desk (src/render/wp/packet.js; src/ui/wp-manual.js shows them). IBM's
// own manual is the binder on the diskette unit, which opens the scan on bitsavers. Our own short text, not IBM's: what THIS recreation does, key by key. Every keystroke sequence here is
// typed into the software by tests/wp_manual.test.js, so the pages and the machine cannot drift apart.

/** A key cap as the page prints it. */
const k = (name) => `<kbd>${name}</kbd>`;
/** A keystroke sequence in the test kit's notation: names of keys in capitals, "quoted" text typed as it stands. */
export const seq = (s) => `<span class="seq">${s.match(/"[^"]*"|\S+/g).map((w) => (w.startsWith('"') ? `<b>${w.slice(1, -1)}</b>`
  : /^[A-Z][A-Z0-9+]+$/.test(w) ? k(w) : `<b>${w}</b>`)).join(' ')}</span>`;

/** The keystroke sequences the pages quote, by name; the test runs each one. */
export const SEQUENCES = {
  typingTasks: 'a ENTER',
  create: 'a ENTER',
  revise: 'b ENTER',
  print: 'e ENTER',
  mainMenu: 'f ENTER',
  diskette: '"WORK01" ENTER',
  element: 'REQST e ENTER',
  copies: 'c ENTER 2 ENTER',
  noPrint: 'd ENTER 2 ENTER',
};

export const PAGES = [
  {
    title: 'Contents',
    html: `
      <p class="lead">This packet covers the everyday work of the Displaywriter: switching on, typing a document,
      changing it, printing it and checking its spelling.</p>
      <ol class="toc">
        <li data-page="1">The keyboard</li>
        <li data-page="2">Starting up</li>
        <li data-page="3">Diskettes</li>
        <li data-page="4">Creating a document</li>
        <li data-page="5">Revising a document</li>
        <li data-page="6">Printing</li>
        <li data-page="7">Messages</li>
        <li data-page="8">Checking spelling</li>
      </ol>
      <p class="aside">On this desk the machine reads your PC keyboard. The page on the keyboard tells you which PC
      key stands for which Displaywriter key. Turn the pages with ← and →, a click or a swipe. Esc closes the
      packet.</p>
      <p class="aside">The full IBM manual is on the binder on the diskette unit: the <i>IBM Displaywriter System
      Operator Reference Guide, Textpack 4/Reportpack</i>, S544-2036-0. Click it to open IBM's scan.</p>`,
  },
  {
    title: 'The keyboard',
    html: `
      <p>Letters, figures and punctuation type as marked. The function keys of the Displaywriter are reached like
      this:</p>
      <table class="keys">
        <tr><th>Displaywriter</th><th>PC keyboard</th></tr>
        <tr><td>${k('ENTER')}</td><td>right Alt (AltGr), or keypad Enter</td></tr>
        <tr><td>${k('RET')} carrier return</td><td>Enter</td></tr>
        <tr><td>${k('CODE')}</td><td>left Alt</td></tr>
        <tr><td>${k('CANCL')}</td><td>Esc</td></tr>
        <tr><td>${k('REQST')} · ${k('PRINT')}</td><td>F1 · F2</td></tr>
        <tr><td>${k('FIND')} · ${k('GO TO')}</td><td>F3 · F4</td></tr>
        <tr><td>${k('MOVE')} · ${k('LINE ADJ')}</td><td>F5 · F6</td></tr>
        <tr><td>${k('SPELL')} · ${k('CHG FMT')}</td><td>F7 · F8</td></tr>
        <tr><td>${k('GET')} · ${k('PAGE END')}</td><td>F9 · F10</td></tr>
        <tr><td>${k('DEL')} · ${k('END')} · ${k('MSG')}</td><td>Delete · End · Insert</td></tr>
        <tr><td>${k('REPLY')} (${k('CODE')} ${k('MSG')})</td><td>left Alt + Insert</td></tr>
        <tr><td>${k('SCREEN DOWN')} · ${k('SCREEN UP')}</td><td>Page Down · Page Up</td></tr>
        <tr><td>cursor keys · ${k('CODE')} ${k('←')}</td><td>arrows · Home</td></tr>
        <tr><td>${k('BKSP')} · ${k('TAB')} · ${k('LOCK')}</td><td>Backspace · Tab · Caps Lock</td></tr>
        <tr><td>${k('CONTROL')}</td><td>left Ctrl</td></tr>
      </table>
      <p class="note"><b>ENTER is not RET.</b> ${k('ENTER')} answers menus and prompts; ${k('RET')} ends a line of
      text. A legend on the front of a key means: hold ${k('CODE')} and press it. Keys with no PC match can be
      clicked on the machine's keyboard.</p>`,
  },
  {
    title: 'Starting up',
    html: `
      <ol class="steps">
        <li>Press the red power switch on the electronics module, under the display. Switch the printer on with its
        own switch.</li>
        <li>The machine tests itself. The test numbers <b>05</b>, <b>06</b> and <b>09</b> appear in turn, about ten
        seconds in all.</li>
        <li>Large IBM initials and <b>*11*</b> mean the test passed but no program diskette is in the unit. Any other
        number means the test failed: switch off and on again.</li>
        <li>Put the program diskette (CMBDSK) in drive 1, the left slot, and close its lever. <i>Loading Program</i>
        shows while it is read.</li>
        <li>The <b>TASK SELECTION</b> menu appears. Put your work diskette, WORK01, in drive 2.</li>
      </ol>
      <p>To choose from any menu, type the ID letter of the item and press ${k('ENTER')}.
      ${seq(SEQUENCES.typingTasks)} chooses Typing Tasks.</p>
      <p class="note">If the program diskette is already in drive 1 when you switch on, the initials are skipped and
      the program loads at once.</p>`,
  },
  {
    title: 'Diskettes',
    html: `
      <p>Your diskettes live in the desk file beside the unit, each in its paper envelope. The left drive holds the
      program diskette, the right one your work diskette.</p>
      <ol class="steps">
        <li><b>Open the lever</b> of the drive: click it. A closed lever locks the diskette in.</li>
        <li><b>Take the diskette out of its envelope</b>: click it in the file. Hold it by its label; never touch
        the brown surface showing through the window.</li>
        <li><b>Insert it</b>: click the open drive. The diskette goes in on its edge, the head window first, its label
        toward the lever.</li>
        <li><b>Close the lever.</b> The drive starts and the diskette is ready.</li>
      </ol>
      <p>To take a diskette out, open the lever and click the diskette: it comes out into your hand. Click it again to
      put it back in its envelope.</p>
      <p class="note">Do not open a lever while the machine is reading or writing that diskette. Keep diskettes away
      from heat, sunlight and magnets, and store them upright in their envelopes.</p>`,
  },
  {
    title: 'Creating a document',
    html: `
      <ol class="steps">
        <li>From TASK SELECTION: ${seq(SEQUENCES.typingTasks)} for <b>Typing Tasks</b>.</li>
        <li>${seq(SEQUENCES.create)} for <b>Create Document</b>.</li>
        <li><i>Type document name; press ENTER.</i> Type a name of your own, such as Letter, and ${k('ENTER')}.</li>
        <li><i>Type diskette name; press ENTER.</i> Type the name exactly as the label reads, in capitals:
        ${seq(SEQUENCES.diskette)}.</li>
        <li>The <b>CREATE OR REVISE DOCUMENT</b> menu shows the document's settings. ${k('ENTER')} accepts them.</li>
        <li>Type. Lines wrap by themselves; press ${k('RET')} only at the end of a paragraph or a short line.</li>
        <li>Press ${k('END')}. The document is stored on the diskette and TYPING TASKS returns.</li>
      </ol>
      <p class="note"><b>Capitals matter.</b> Typed as <b>work01</b>, the name is not found and the machine asks you
      to <i>Insert diskette (work01)</i>. Press ${k('REPLY')} (${k('CODE')} ${k('MSG')}: left Alt and Insert) to refuse;
      TYPING TASKS returns, and you start again with ${seq(SEQUENCES.create)}.</p>`,
  },
  {
    title: 'Revising a document',
    html: `
      <p>From TYPING TASKS, ${seq(SEQUENCES.revise)} for <b>Revise Document</b>, then the document name, the
      diskette name and ${k('ENTER')} as when creating it. The text comes back with the cursor at its start.</p>
      <h3>Moving the cursor</h3>
      <p>The arrow keys move one character or one line. ${k('CODE')} ${k('←')} (Home) goes to the start of the line;
      ${k('CODE')} ${k('↑')} and ${k('CODE')} ${k('↓')} go to the top and the end of the page.</p>
      <h3>Inserting</h3>
      <p>Whatever you type goes in before the cursor; the status line shows <b>Ins</b>. ${k('CODE')} ${k('8')}
      switches to <b>Repl</b>, where typing replaces the characters under the cursor, and back.</p>
      <h3>Deleting</h3>
      <p>Put the cursor on the first character and press ${k('DEL')}. At <i>Delete what?</i> extend the highlight:
      with the arrow keys, or by typing the character to stop at. A space takes a word, ${k('RET')} the rest of the
      paragraph. ${k('ENTER')} deletes; ${k('CANCL')} leaves the text alone.</p>
      <h3>Saving</h3>
      <p>${k('END')} stores the revised document and returns to TYPING TASKS.</p>`,
  },
  {
    title: 'Printing',
    html: `
      <ol class="steps">
        <li>Switch the printer on. With the sheet feeder on it lays in each sheet itself.</li>
        <li>From TYPING TASKS: ${seq(SEQUENCES.print)} for <b>Print Document</b>, then the document name and
        ${seq(SEQUENCES.diskette)}.</li>
        <li>The <b>PRINT DOCUMENT</b> menu: ${k('ENTER')} prints every page, one copy. To change an item, type its ID
        letter, ${k('ENTER')}, the new choice and ${k('ENTER')}: ${seq(SEQUENCES.copies)} asks for two copies.</li>
        <li>TYPING TASKS returns. The printing goes on while you work.</li>
        <li><b>==&gt;</b> appears at the bottom left. Press ${k('MSG')}: <i>Put on printer element (086 001)</i>. The
        machine asks for the printwheel the document was typed for.</li>
        <li>With that element on the printer, press ${seq(SEQUENCES.element)}: REQST shows the TEXTPACK REQUEST
        TASKS menu, and item <b>e</b> is <i>Continue Printing With Element Now On Printer</i>.</li>
      </ol>
      <p class="note">When it is done, ${k('MSG')} shows <i>(Letter) printed.</i> Until then the document cannot be revised:
      <i>(Letter) already in use</i>. While typing, ${k('PRINT')} prints the page on
      the screen.</p>`,
  },
  {
    title: 'Messages',
    html: `
      <p>The machine tells you things on the bottom line of the screen. When a message is waiting, a blinking
      <b>==&gt;</b> shows at the bottom left and a long tone sounds. Press ${k('MSG')} to read it; press it again for
      the next one, or to clear the line.</p>
      <table class="msgs">
        <tr><th>Message</th><th>What to do</th></tr>
        <tr><td>Insert diskette (WORK01); press ENTER.</td><td>Put that diskette in a drive and press ENTER; if the
        name was mistyped, REPLY (CODE MSG) gives up.</td></tr>
        <tr><td>(Letter) already exists.</td><td>Choose another name, or revise the one there.</td></tr>
        <tr><td>(Letter) not found on diskette WORK01.</td><td>Check the name; the index (Typing Tasks, d) lists
        what is there.</td></tr>
        <tr><td>(Letter) already in use</td><td>It is waiting to print, or printing: let it finish.</td></tr>
        <tr><td>Put on printer element (086 001)</td><td>REQST e ENTER once it is on.</td></tr>
        <tr><td>Turn printer on.</td><td>Use the printer's power switch.</td></tr>
        <tr><td>Load paper in printer; press LOAD.</td><td>Lay a sheet in, or switch the sheet feeder on.</td></tr>
        <tr><td>Printer cover open. Close it; press START.</td><td>Close the cover.</td></tr>
        <tr><td>Diskette WORK01 full.</td><td>Delete documents you no longer need, or use another diskette.</td></tr>
        <tr><td>(Letter) printed.</td><td>Nothing: it is done.</td></tr>
      </table>`,
  },
  {
    title: 'Checking spelling',
    html: `
      <ol class="steps">
        <li>While typing a document, press ${k('SPELL')} (F7). The document is stored and SPELLING TASKS loads with
        Check Document chosen and the document's name ready.</li>
        <li>${k('ENTER')} for the name, ${k('ENTER')} for the diskette.</li>
        <li><b>CHECK DOCUMENT</b>: ${k('ENTER')} accepts a prompted check, with hyphenation.</li>
        <li><b>HYPHENATE AND PAGINATE DOCUMENT</b>: ${seq(SEQUENCES.noPrint)} if the pages should not be printed
        afterwards, then ${k('ENTER')} to start.</li>
        <li>At each word not in the dictionary: ${k('SPELL')} leaves it highlighted, ${k('ENTER')} removes the
        highlighting, or type the word correctly and press ${k('ENTER')}.</li>
        <li><i>Hyphenate where?</i> ${k('ENTER')} breaks the word where the cursor is.</li>
      </ol>
      <p>When the check is done TYPING TASKS returns, with Revise Document ready for the same document, and the messages
      (${k('MSG')}) say how many words were marked.</p>`,
  },
];
