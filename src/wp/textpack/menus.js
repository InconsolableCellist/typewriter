// The menu tree as data (architecture 7.3). Rows and columns are read off the grids of software-screens.md (SS 2),
// which were measured from the manuals' facsimiles; menus with no facsimile (PAGE FORMAT, HEADER AND FOOTER, GET,
// GLOBAL, the smaller work diskette menus) follow the same conventions with our own row choices.
//
// A menu: title and its [row, col]; `head` and `text` are static [row, col, text]; `cols` gives the ID, ITEM, YOUR
// CHOICE and POSSIBLE CHOICES columns; `finished` puts "When finished with this menu, press ENTER." on row 22.
// An item either goes somewhere (`go`), is present only as data (`na`, answered with a "not available" message), or
// holds a choice under `key` of a `kind`: enum (`values`), int (`min`, `max`), text (`max`), name (a diskette name),
// page (a system page number or 0), pages (a list of them). `possible` lines start in the POSSIBLE CHOICES column.

const yesNo = ['1 = Yes    2 = No'];
const choiceHead = (choice, possible) => [
  [6, choice, 'YOUR'], ...(possible ? [[6, possible, 'POSSIBLE']] : []),
  [7, 3, 'ID'], [7, 7, 'ITEM'], [7, choice, 'CHOICE'], ...(possible ? [[7, possible, 'CHOICES']] : []),
];

export const MENUS = {
  taskSelection: {
    title: 'TASK SELECTION', at: [3, 24], head: [[4, 14, 'ID'], [4, 19, 'ITEM']], cols: { id: 14, item: 19 },
    items: [
      { id: 'a', row: 5, item: 'Typing Tasks:', sub: ['Create, Revise or Paginate Documents'], go: 'typingTasks' },
      { id: 'b', row: 7, item: 'Work Diskette Tasks:', go: 'workDiskTasks', sub: [
        'Delete or Duplicate Documents,', 'Duplicate, Condense or', 'Erase/Initialize(Name) Diskette,',
        'Print Index of Diskette Contents, Change', 'Document or Diskette Name, Recover Documents,',
        'Display or Convert Final-form Documents'] },
      { id: 'c', row: 14, item: 'Program Diskette Tasks:', go: 'programTasks', sub: [
        'Default Formats, Duplicate Setups,', 'Printer and Work Station Description,',
        'Duplicate and Erase Program Diskette,', 'Feature Program Diskette Tasks,',
        'Create and Update Combined Program Diskette'] },
      { id: 'd', row: 20, item: 'Spelling Tasks', go: 'spellingTasks' },
      { id: 'e', row: 21, item: 'Feature Tasks', na: true },
      { id: 'f', row: 22, item: 'Key-To-Print Task', na: true },
      { id: 'g', row: 23, item: 'Merge Tasks', na: true },
    ],
  },

  typingTasks: {
    title: 'TYPING TASKS', at: [4, 24], head: [[6, 19, 'ID'], [6, 25, 'ITEM']], cols: { id: 19, item: 25 },
    items: [
      { id: 'a', row: 8, item: 'Create Document', go: 'create' },
      { id: 'b', row: 9, item: 'Revise Document', go: 'revise' },
      { id: 'c', row: 10, item: 'Paginate Document', go: 'paginate' },
      { id: 'd', row: 11, item: 'Display Index of Diskette Contents', go: 'index' },
      { id: 'e', row: 12, item: 'Print Document', go: 'print' },
      { id: 'f', row: 13, item: 'Go to Task Selection', go: 'taskSelection' },
    ],
  },

  createRevise: {
    title: 'CREATE OR REVISE DOCUMENT', at: [4, 22], head: choiceHead(36, 46), cols: { id: 3, item: 7, choice: 36, possible: 46 },
    finished: true,
    items: [
      { id: 'a', row: 9, item: 'Document Comment', key: 'comment', kind: 'text', max: 44 },
      { id: 'b', row: 11, item: 'Change Document Format', go: 'docFormat' },
      { id: 'c', row: 13, item: 'Change Alternate Format', go: 'altFormat' },
      { id: 'd', row: 15, item: 'Preserve Page Numbers', key: 'preserve', kind: 'enum', values: [1, 2], possible: ['1 = Yes    2 = No'] },
    ],
  },

  formatSelection: {
    title: 'FORMAT SELECTION', at: [4, 27], head: [[6, 20, 'ID'], [6, 26, 'ITEM']], cols: { id: 20, item: 26 }, finished: true,
    items: [
      { id: 'a', row: 8, item: 'Change Line Format', go: 'lineFormat' },
      { id: 'b', row: 9, item: 'Change Margins and Tabs', go: 'marginsTabs' },
      { id: 'c', row: 10, item: 'Change Page Format', go: 'pageFormat' },
      { id: 'd', row: 11, item: 'Change Header and Footer', go: 'headerFooter' },
      { id: 'e', row: 12, item: 'Change Alternating Headers and Footers', na: true },
    ],
  },

  // CHG FMT with the cursor on the first position of a page (ORG p.157).
  formatSelectionPage: {
    title: 'FORMAT SELECTION', at: [4, 27], head: [[6, 20, 'ID'], [6, 26, 'ITEM']], cols: { id: 20, item: 26 }, finished: true,
    items: [
      { id: 'a', row: 8, item: 'Change Line Format', go: 'lineFormat' },
      { id: 'b', row: 9, item: 'Change Margins and Tabs', go: 'marginsTabs' },
      { id: 'c', row: 10, item: 'Change Page Format', go: 'pageFormat' },
      { id: 'd', row: 11, item: 'Change Header and Footer', go: 'headerFooter' },
      { id: 'e', row: 12, item: 'Change Alternating Headers and Footers', na: true },
      { id: 'f', row: 13, item: 'Return All Formats to Starting Choice', go: 'retAll' },
      { id: 'g', row: 14, item: 'Return Line Format, Margins and Tabs to Starting Choice', go: 'retLine' },
      { id: 'h', row: 15, item: 'Return Typestyle to Starting Choice', go: 'retType' },
      { id: 'i', row: 16, item: 'Begin Using Document Format', go: 'docFmt' },
      { id: 'j', row: 17, item: 'Begin Using Alternate Format', go: 'altFmt' },
    ],
  },

  // CHG FMT with the cursor on the first position of any other line (ORG p.158).
  formatSelectionLine: {
    title: 'FORMAT SELECTION', at: [4, 27], head: [[6, 20, 'ID'], [6, 26, 'ITEM']], cols: { id: 20, item: 26 }, finished: true,
    items: [
      { id: 'a', row: 8, item: 'Change Line Format', go: 'lineFormat' },
      { id: 'b', row: 9, item: 'Change Margins and Tabs', go: 'marginsTabs' },
      { id: 'c', row: 10, item: 'Return Line Format, Margins and Tabs to Starting Choice', go: 'retLine' },
      { id: 'd', row: 11, item: 'Return Typestyle to Starting Choice', go: 'retType' },
    ],
  },

  // CHG FMT within a line (ORG p.159): a typestyle of the same pitch only.
  formatSelectionMid: {
    title: 'FORMAT SELECTION', at: [4, 27], head: choiceHead(46, 54), cols: { id: 3, item: 7, choice: 46, possible: 54 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Typestyle Number (same pitch only)', key: 'typestyle', kind: 'typestyle' },
      { id: 'b', row: 11, item: 'Return Typestyle to Starting Choice', go: 'retType' },
    ],
  },

  lineFormat: {
    title: 'LINE FORMAT', at: [4, 30], head: choiceHead(27, 38), cols: { id: 3, item: 7, choice: 27, possible: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Line Spacing', key: 'spacing', kind: 'enum', values: [1, 2, 3, 4, 5],
        possible: ['1 = Single  2 = Double  3 = Triple', '4 = Half    5 = 1 and 1/2'] },
      { id: 'b', row: 11, item: 'Line Alignment', key: 'align', kind: 'enum', values: [1, 2, 3], possible: ['1 = Left    2 = Justify', '3 = 1/2 Justify'] },
      { id: 'c', row: 13, item: 'Typestyle Number', key: 'typestyle', kind: 'typestyle',
        possible: ['1 - 31 (10 pitch)', '80 - 111 (12 Pitch)', '154 - 175 (Proportional)', '215 - 230 (15 Pitch)'] },
      { id: 'd', row: 17, item: 'Lines/cm or in.', key: 'lpi', kind: 'enum', values: [1, 2, 3, 4, 5],
        possible: ['1 = 2.09/cm or 5.3/in.', '2 = 2.36/cm or 6/in.   3 = 3.15/cm or 8/in.', '4 = 9.45/cm or 24/in.  5 = 2.0/cm or 5.08/in.'] },
      { id: 'e', row: 20, item: 'Adjust Line Endings', key: 'adjust', kind: 'enum', values: [1, 2], possible: ['1 = Yes     2 = No'] },
      { id: 'f', row: 21, item: 'Zone Width', key: 'zone', kind: 'int', min: 1, max: 30, possible: ['1 - 30'] },
    ],
  },

  pageFormat: {
    title: 'PAGE FORMAT', at: [4, 31], head: choiceHead(41, 47), cols: { id: 3, item: 7, choice: 41, possible: 47 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'First Typing Line, First Page', key: 'firstLine', kind: 'int', min: 1, max: 999, possible: ['1 - 999'] },
      { id: 'b', row: 10, item: 'First Typing Line Following Pages', key: 'firstLineNext', kind: 'int', min: 1, max: 999, possible: ['1 - 999'] },
      { id: 'c', row: 11, item: 'Last Typing Line', key: 'lastLine', kind: 'int', min: 2, max: 999, possible: ['2 - 999'] },
      { id: 'd', row: 13, item: 'Paper or Envelope Size', key: 'paper', kind: 'enum', values: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        possible: ['1 = A4 210x297     2 = A4L', '3 = P4 8.5x11      4 = P4L', '5 = Legal 8.5x14   6 = Legal L',
          '7 = Env. 9.5x4.13  8 = C5 Env.', '9 = Other in mm'] },
      { id: 'e', row: 19, item: 'Printing Paper Source', key: 'source', kind: 'enum', values: [1, 2, 3, 4],
        possible: ['1 = Top     2 = Bottom', '3 = Bottom This Page Only', '4 = Manual Feed'] },
    ],
  },

  headerFooter: {
    title: 'HEADER AND FOOTER', at: [4, 29], head: choiceHead(30, 38), cols: { id: 3, item: 7, choice: 30, possible: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Create or Revise Header', go: 'header' },
      { id: 'b', row: 10, item: 'First Header Line', key: 'headerLine', kind: 'int', min: 1, max: 999, possible: ['1 - 999'] },
      { id: 'c', row: 11, item: 'Print Header On', key: 'headerOn', kind: 'enum', values: [1, 2], possible: ['1 = All Pages  2 = All But First Page'] },
      { id: 'd', row: 13, item: 'Create or Revise Footer', go: 'footer' },
      { id: 'e', row: 14, item: 'First Footer Line', key: 'footerLine', kind: 'int', min: 2, max: 999, possible: ['2 - 999'] },
      { id: 'f', row: 15, item: 'Print Footer On', key: 'footerOn', kind: 'enum', values: [1, 2], possible: ['1 = All Pages  2 = All But First Page'] },
    ],
  },

  screenFormat: {
    title: 'SCREEN FORMAT', at: [4, 30], head: choiceHead(27, 38), cols: { id: 3, item: 7, choice: 27, possible: 38 }, finished: true,
    items: [{ id: 'a', row: 9, item: 'Display Codes', key: 'displayCodes', kind: 'enum', values: [1, 2], possible: ['1 = Yes     2 = No'] }],
  },

  paginate: {
    title: 'PAGINATE DOCUMENT', at: [4, 25], head: choiceHead(40, 49), cols: { id: 3, item: 7, choice: 40, possible: 49 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Paginate From Page', key: 'from', kind: 'int', min: 1, max: 1, possible: ['1 - {pages}'] },
      { id: 'b', row: 11, item: 'Paginate on Exact Line Count', key: 'exact', kind: 'enum', values: [1, 2], possible: yesNo },
      { id: 'c', row: 13, item: 'Adjust Line Endings', key: 'adjust', kind: 'enum', values: [1, 2], possible: yesNo },
      { id: 'd', row: 15, item: 'Adjust Page Endings', key: 'pageEnds', kind: 'enum', values: [1, 2], possible: yesNo },
    ],
  },

  printDocument: {
    title: 'PRINT DOCUMENT', at: [4, 26], head: choiceHead(27, 36), cols: { id: 3, item: 7, choice: 27, possible: 36 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Print From Page', key: 'from', kind: 'page', possible: ['0 = First Page,', '1 = 9999.9.9'] },
      { id: 'b', row: 11, item: 'Print Through Page', key: 'through', kind: 'page', possible: ['0 = Last Page,', '1 = 9999.9.9'] },
      { id: 'c', row: 13, item: 'Print Quantity', key: 'quantity', kind: 'int', min: 1, max: 99, possible: ['1 - 99'] },
      { id: 'd', row: 15, item: 'Paper Handling', key: 'paper', kind: 'enum', values: [1, 2, 3],
        possible: ['1 = Cut Paper, Manual Feed', '2 = Cut Paper, Automatic Feed', '3 = Continuous Paper'] },
      { id: 'e', row: 19, item: 'Cancel on Error', key: 'cancelOnError', kind: 'enum', values: [1, 2], possible: ['1 = Yes     2 = No'] },
    ],
  },

  requestTasks: {
    title: 'TEXTPACK REQUEST TASKS', at: [4, 23], head: [[6, 10, 'ID'], [6, 16, 'ITEM']], cols: { id: 10, item: 16 },
    items: [
      { id: 'a', row: 8, item: 'Print Document', go: 'print' },
      { id: 'b', row: 9, item: 'Display Print Queue or Cancel Print Job', go: 'printQueue' },
      { id: 'c', row: 10, item: 'Change Printing Order', go: 'printOrder' },
      { id: 'd', row: 11, item: 'Display Index of Diskette Contents', go: 'index' },
      { id: 'e', row: 12, item: 'Continue Printing With Element Now On Printer', go: 'continuePrint' },
      { id: 'f', row: 13, item: 'Request Printer', na: true },
      { id: 'g', row: 14, item: 'Release Printer', na: true },
      { id: 'h', row: 15, item: 'Start Printer', na: true },
    ],
  },

  workDiskTasks: {
    title: 'WORK DISKETTE TASKS', at: [4, 23], head: [[6, 16, 'ID'], [6, 21, 'ITEM']], cols: { id: 16, item: 21 },
    items: [
      { id: 'a', row: 8, item: 'Delete Document', go: 'deleteDocument' },
      { id: 'b', row: 9, item: 'Duplicate Document', go: 'duplicateDocument' },
      { id: 'c', row: 10, item: 'Change Document Name', go: 'changeDocName' },
      { id: 'd', row: 11, item: 'Change Diskette Name', go: 'changeDiskName' },
      { id: 'e', row: 12, item: 'Duplicate Diskette', go: 'duplicateDiskette' },
      { id: 'f', row: 13, item: 'Condense Diskette', go: 'condenseDiskette' },
      { id: 'g', row: 14, item: 'Erase or Initialize (Name) Diskette', go: 'eraseInit' },
      { id: 'h', row: 15, item: 'Recover Documents', go: 'recover' },
      { id: 'i', row: 16, item: 'Print Index of Diskette Contents', go: 'printIndex' },
      { id: 'j', row: 17, item: 'Display Final-form Document', na: true },
      { id: 'k', row: 18, item: 'Convert Final-form Document', na: true },
      { id: 'l', row: 19, item: 'Go to Task Selection', go: 'taskSelection' },
    ],
  },

  deleteDocument: {
    title: 'DELETE DOCUMENT', at: [4, 25], head: choiceHead(38), cols: { id: 3, item: 7, choice: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Document Name', key: 'name', kind: 'text', max: 44 },
      { id: 'b', row: 10, item: 'Diskette Name', key: 'disk', kind: 'name' },
    ],
  },

  duplicateDocument: {
    title: 'DUPLICATE DOCUMENT', at: [4, 24], head: choiceHead(38), cols: { id: 3, item: 7, choice: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Document Name', key: 'name', kind: 'text', max: 44 },
      { id: 'b', row: 10, item: 'Diskette Name', key: 'disk', kind: 'name' },
      { id: 'c', row: 12, item: 'New Document Name', key: 'to', kind: 'text', max: 44 },
      { id: 'd', row: 13, item: 'Diskette Name', key: 'toDisk', kind: 'name' },
    ],
  },

  changeDocName: {
    title: 'CHANGE DOCUMENT NAME', at: [4, 23], head: choiceHead(27), cols: { id: 3, item: 7, choice: 27 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Name of Document', key: 'name', kind: 'text', max: 44 },
      { id: 'b', row: 10, item: 'Document Comment', key: 'comment', kind: 'text', max: 44 },
    ],
  },

  changeDiskName: {
    title: 'CHANGE DISKETTE NAME', at: [4, 24], head: choiceHead(38), cols: { id: 3, item: 7, choice: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Diskette Name (Left Slot)', key: 'left', kind: 'name' },
      { id: 'b', row: 10, item: 'Diskette Name (Right Slot)', key: 'right', kind: 'name' },
    ],
  },

  duplicateDiskette: {
    title: 'DUPLICATE DISKETTE', at: [4, 24], head: choiceHead(38), cols: { id: 3, item: 7, choice: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'From Diskette Name', key: 'from', kind: 'name' },
      { id: 'b', row: 10, item: 'To Diskette Name', key: 'to', kind: 'name' },
    ],
  },

  condenseDiskette: {
    title: 'CONDENSE DISKETTE', at: [4, 25], head: choiceHead(38), cols: { id: 3, item: 7, choice: 38 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'From Diskette Name', key: 'from', kind: 'name' },
      { id: 'b', row: 10, item: 'To Diskette Name', key: 'to', kind: 'name' },
    ],
  },

  eraseInit: {
    title: 'ERASE OR INITIALIZE(NAME) DISKETTE', at: [4, 22], head: choiceHead(38, 52), cols: { id: 3, item: 7, choice: 38, possible: 52 },
    finished: true, text: [[18, 2, 'Insert Diskette to be Erased or Initialized into diskette slot.']],
    items: [{ id: 'a', row: 9, item: 'Diskette Slot', key: 'slot', kind: 'enum', values: [1, 2], possible: ['1 = Left', '2 = Right'] }],
  },

  recover: {
    title: 'RECOVER DOCUMENTS', at: [4, 27], head: choiceHead(38, 52), cols: { id: 3, item: 7, choice: 38, possible: 52 },
    finished: true, text: [[18, 2, 'Insert diskette to be recovered into diskette slot; press ENTER.']],
    items: [{ id: 'a', row: 9, item: 'Diskette Slot', key: 'slot', kind: 'enum', values: [1, 2], possible: ['1 = Left', '2 = Right'] }],
  },

  get: {
    title: 'GET', at: [4, 38], head: choiceHead(30, 46), cols: { id: 3, item: 7, choice: 30, possible: 46 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Document Name', key: 'name', kind: 'text', max: 44 },
      { id: 'b', row: 10, item: 'Diskette Name', key: 'disk', kind: 'name' },
      { id: 'c', row: 12, item: 'System Page Number(s)', key: 'pages', kind: 'pages' },
      { id: 'd', row: 14, item: 'Insert Included Text', key: 'include', kind: 'enum', values: [1, 2], possible: yesNo },
    ],
  },

  global: {
    title: 'GLOBAL REPLACE/DELETE', at: [4, 27], head: choiceHead(21, 40), cols: { id: 3, item: 7, choice: 21, possible: 40 }, finished: true,
    items: [
      { id: 'a', row: 9, item: 'Kind Of Search', key: 'search', kind: 'enum', values: [1, 2], possible: ['1 = Prompted  2 = Automatic'] },
      { id: 'b', row: 10, item: 'Kind of Match', key: 'match', kind: 'enum', values: [1, 2], possible: ['1 = Word      2 = Exact Character'] },
      { id: 'c', row: 12, item: 'Search For:', key: 's1', kind: 'text', max: 60 },
      { id: 'd', row: 13, item: 'Replace With:', key: 'r1', kind: 'text', max: 60 },
      { id: 'e', row: 15, item: 'Search For:', key: 's2', kind: 'text', max: 60 },
      { id: 'f', row: 16, item: 'Replace With:', key: 'r2', kind: 'text', max: 60 },
      { id: 'g', row: 18, item: 'Search For:', key: 's3', kind: 'text', max: 60 },
      { id: 'h', row: 19, item: 'Replace With:', key: 'r3', kind: 'text', max: 60 },
    ],
  },

  instructions: {
    title: 'INSTRUCTIONS', at: [4, 33], head: [[5, 12, 'ID'], [5, 17, 'ITEM']], cols: { id: 12, item: 17 },
    items: [
      { id: 'a', row: 6, item: 'Begin Keep', go: 'beginKeep' },
      { id: 'b', row: 7, item: 'End Keep', go: 'endKeep' },
      { id: 'c', row: 8, item: 'Include', na: true },
      { id: 'd', row: 9, item: 'Math', na: true },
      { id: 'e', row: 10, item: 'File Report Instructions', na: true },
      { id: 'f', row: 11, item: 'Multi-Column File Listing', na: true },
      { id: 'g', row: 12, item: 'Summary Math', na: true },
      { id: 'h', row: 13, item: 'Conditional Text: Field or Variable Empty', na: true },
      { id: 'i', row: 14, item: 'Conditional Text: Field or Variable Not Empty', na: true },
      { id: 'j', row: 15, item: 'End of Conditional Text', na: true },
      { id: 'k', row: 16, item: 'Skip to Line', na: true },
      { id: 'l', row: 17, item: 'Begin Spelling Check', go: 'beginSpell' },
      { id: 'm', row: 18, item: 'End Spelling Check', go: 'endSpell' },
      { id: 'n', row: 19, item: 'Language For Spelling Check', na: true },
    ],
  },

  programTasks: {
    title: 'TEXTPACK PROGRAM DISKETTE TASKS', at: [4, 24], head: [[5, 12, 'ID'], [5, 17, 'ITEM']], cols: { id: 12, item: 17 },
    items: [
      ...['Change Document Format Defaults', 'Change Alternate Format Defaults', 'Change Printer Description',
        'Change Work Station Description', 'Duplicate Machine Setup', 'Duplicate Program Diskette', 'Erase Program Diskette',
        'Duplicate Spelling Supplement', 'Change Math Format Defaults', 'Change Paginate Document Defaults',
        'Change Check Document Defaults', 'Create New Combined Program Diskette', 'Update Combined Program Diskette',
        'Change Menu Abbreviations'].map((item, i) => ({ id: 'abcdefghijklmn'[i], row: 6 + i, item, na: true })),
      { id: 'o', row: 20, item: 'Go to Task Selection', go: 'taskSelection' },
    ],
  },

  spellingTasks: {
    title: 'SPELLING TASKS', at: [4, 26], head: [[6, 13, 'ID'], [6, 19, 'ITEM']], cols: { id: 13, item: 19 },
    items: [
      { id: 'a', row: 8, item: 'Check Document', go: 'checkDocument' },
      { id: 'b', row: 9, item: 'Load Supplement', go: 'loadSupplement' },
      { id: 'c', row: 10, item: 'Clear Supplement', go: 'clearSupplement' },
      { id: 'd', row: 11, item: 'Store Supplement On Program Diskette', go: 'storeSupplement' },
      { id: 'e', row: 12, item: 'Choose Spelling Language Dictionary', na: true },
      { id: 'f', row: 13, item: 'Create Document Of Supplemental Words', go: 'supplementDocument' },
      { id: 'g', row: 14, item: 'Go To Task Selection', go: 'taskSelection' },
    ],
  },

  // CHECK DOCUMENT (ORG p.108, SS 2.9). The YOUR CHOICE values stand two columns right of the heading, as in the grid.
  checkDocument: {
    title: 'CHECK DOCUMENT', at: [4, 27], cols: { id: 2, item: 5, choice: 36, possible: 43 }, finished: true,
    head: [[6, 34, 'YOUR'], [6, 43, 'POSSIBLE'], [7, 2, 'ID'], [7, 5, 'ITEM'], [7, 34, 'CHOICE'], [7, 43, 'CHOICES']],
    text: [[13, 5, 'For Spelling Check']],
    items: [
      { id: 'a', row: 9, item: 'Kind Of Spelling Check', key: 'kind', kind: 'enum', values: [1, 2, 3],
        possible: ['1 = Prompted  2 = Automatic', '3 = None'] },
      { id: 'b', row: 12, item: 'System Page Number(s)', key: 'pages', kind: 'pages', max: 10 },
      { id: 'c', row: 15, item: 'Hyphenation/Pagination', key: 'hyphenate', kind: 'enum', values: [1, 2], possible: ['1 = Yes       2 = No'] },
    ],
  },

  // HYPHENATE AND PAGINATE DOCUMENT (ORG p.167, SS 2.9).
  hyphenatePaginate: {
    title: 'HYPHENATE AND PAGINATE DOCUMENT', at: [4, 22], cols: { id: 3, item: 7, choice: 42, possible: 49 }, finished: true,
    head: [[6, 40, 'YOUR'], [6, 49, 'POSSIBLE'], [7, 3, 'ID'], [7, 7, 'ITEM'], [7, 40, 'CHOICE'], [7, 49, 'CHOICES']],
    text: [[12, 7, 'Check from Page']],
    items: [
      { id: 'a', row: 9, item: 'Dictionary Hyphenation', key: 'hyphenation', kind: 'enum', values: [1, 2, 3],
        possible: ['1 = Prompted 2 = Automatic', '3 = None'] },
      { id: 'b', row: 11, choiceRow: 12, item: 'Paginate, Hyphenate, Spell', key: 'from', kind: 'int', min: 1, max: 1, possible: ['1 - {pages}'] },
      { id: 'c', row: 13, item: 'Paginate On Exact Line Count', key: 'exact', kind: 'enum', values: [1, 2], possible: ['1 = Yes      2 = No'] },
      { id: 'd', row: 14, item: 'Print Paginated Pages', key: 'print', kind: 'enum', values: [1, 2], possible: ['1 = Yes      2 = No'] },
      { id: 'e', row: 15, item: 'Paper Handling', key: 'paper', kind: 'enum', values: [1, 2, 3],
        possible: ['1 = Cut Paper,Manual Feed', '2 = Cut Paper,Automatic Feed', '3 = Continuous Paper'] },
    ],
  },
};
