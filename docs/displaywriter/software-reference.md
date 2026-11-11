# Textpack 4 editor: reimplementation reference

Behavioural specification of the Textpack 4 (1982) word-processing program for the `wordproc1980` machine,
written to implement `src/wp/` from. Behaviour only: no code, no ROM, no names or marks in the UI
(see `docs/displaywriter-plan.md`, *Ground rules*). The operator-visible wording of prompts and messages is
quoted exactly; everything else is summarised.

## 0. Sources and conventions

| Tag | Document | Page numbering |
|---|---|---|
| **ORG p.N** | S544-2036-0 *Operator Reference Guide, Textpack 4/Reportpack* (Feb 1982, with TNLs SN44-2075 Aug 1982 and SN44-2021 Apr 1983 merged in the scan) | PDF page (form feeds + 1) |
| TB1 p.N | *Displaywriter Operator Training Book 1* (scan in dw-docs) | PDF page |
| TB2 p.N | S544-2035-0 *Operator Training Book 2, Selectable Topics, Textpack 4* | PDF page |
| WSPG p.N | S544-2037-0 *Work Station Procedures Guide, Textpack 4* | PDF page |
| MD p.1 | *6580 Machine Description* (Nov 1983) | PDF page |
| TP4note | `IBM_Displaywriter_and_TEXTPACK4.pdf`, a short modern hobbyist note (not an IBM document) | n/a |

ORG is the primary source. TB2, WSPG, MD and TP4note are used only to fill gaps ORG leaves, and are marked.

Markers: **[UNCLEAR]** the manual is ambiguous or the scan is damaged; **[INFERRED]** my deduction from
several statements, not stated outright; **[NOT IN ORG]** the reference guide does not give it.

Important caveat: ORG says the complete list of prompts and messages, with numbers, causes and recovery
actions, is in a separate book, *Prompts and Messages Guide, Textpack 4/Reportpack* S544-2122, which is
not in `dw-docs/` (ORG p.4, p.33). ORG and the training books quote only the messages that come up in
their procedures. Section 6 is therefore a partial catalogue, and message **numbers** are not available.

Ignored: Reportpack file tasks (record selection, sort, file descriptions), Math, Merge, Column Layout
details, Key-To-Print, communications and combined-program-diskette maintenance, except where they
touch the editor.

---

## 1. Screen model (25 x 80 display)

ORG p.28-33. The 25-line display has 20 text lines of 80 characters, plus 3 lines at the top and 2 at the
bottom (ORG p.28).

| Row | Area | Content | Source |
|---|---|---|---|
| 1 | Status line 1 | Fields A-F: A current function (e.g. `Copy Text`, `Spell Check`, `Format Change`, `Chg Doc Fmt`, `Displaying Index`, `Paginating Document`); B part of the document name (up to 20 chars, ORG p.363); C Insert or Replace mode; D keystroke save/playback (`Save`, `Play`); E name of the code under the cursor (Appendix B names, section 5); F original program/feature diskette name (combined diskettes only). With Alternate Tasks on, a task number `1`/`2` at the right edge | ORG p.29-30, p.253, p.411, p.413, p.558; TB2 p.62 |
| 2 | Status line 2 | G left (or only) diskette name; H right diskette name (blank on a single unit); I system page number of the displayed page, shown as `Pg. 2`; J line number from top edge of paper to the cursor line, shown as `Ln. 53` (includes blank lines above the first typing line); K active keyboard number `Kyb 1`; L pitch `Pitch 12` (10, 11 = PSM, 12, 15) | ORG p.30-31, p.110; TB2 p.135 |
| 3 | Scale line (typing tasks, MARGINS AND TABS menu, header/footer typing) | Left margin `«`, right margin `»`, tab marks, centre point, scale-line cursor (a highlighted scale position). Numbers every 10 positions with `:` at the 5s, `.` elsewhere: `«.2....:....3....:....4 ... 8....:....».....:.` Segments horizontally with the text | ORG p.29, p.31, p.183 |
| 4-23 | Typing and menu area | Document text or a menu | ORG p.32 |
| 24 | Prompt line | Highlighted. Guides the operator a step at a time; the cursor is here while a menu is shown | ORG p.32-33 |
| 25 | Message line | Task status (e.g. print complete), printer needs, errors. A blinking arrow `==>` (message indicator) appears when messages are queued; MSG shows/clears them | ORG p.33, p.480, p.253 |

Status line 1 in a sample spell-check screen: `|Spell Check |Assets | | |U.S. English | | |`; status line 2:
`|DISK01| | |Pg. 2 |Ln. 53 |Kyb 1 | |` (ORG p.110, rendered). Field positions and widths are not given
**[UNCLEAR]**; take them from the rendered samples (ORG p.110, TB2 p.135). TP4note says positions 1-6 of
the diskette line hold the left diskette name and 8-13 the right one, and an unreadable diskette shows
`******`.

Exact text in field C for Insert/Replace is not shown in any sample **[UNCLEAR]**.

### 1.1 Cursor and text display
- The text cursor is a brightened line under a character position; the character above it is also
  highlighted. The scale line highlights the same column (ORG p.32). With PSM typestyles or Display Codes
  = Yes, the scale cursor may not sit exactly over the text cursor (ORG p.31, p.508).
- In menus the cursor is on the prompt line and moves only by typing or BKSP; cursor keys do nothing
  (ORG p.32).
- **Segmenting:** lines longer than the screen scroll horizontally when the cursor reaches the screen edge
  with Cursor Left/Right (ORG p.32). **Scrolling:** Cursor Up/Down at the top/bottom edge scrolls the page
  vertically (ORG p.32). The screen shows one page at a time; it never shows two pages at once (ORG p.511).
- **Line spacing on screen:** on the 25-line display text always shows single-spaced whatever the line
  spacing; the `Ln.` counter advances by the true spacing per carrier return (ORG p.282).
- **Code symbols:** with Display Codes = No (default) a code's symbol appears only when the cursor is on
  it and its name shows in status field E; text looks as printed. With Display Codes = Yes all symbols
  show all the time and can push text right (ORG p.226, p.508). Carrier returns and tabs: see section 5.
- **Non-typing area:** to the right of a carrier return the cursor can stand, status field E shows
  `Non-Typing Area`, and typing is not possible there (ORG p.560).

### 1.2 Tones
Two beeps (ORG p.53):
- **Long beep:** a message needs immediate attention.
- **Short beep:** (a) the cursor passes the Last Typing Line of the PAGE FORMAT (a cue to type a Page End);
  (b) with Auto Carrier Return Off, typing into the zone (Zone Width characters before the right margin),
  like a typewriter bell (ORG p.53, p.180, p.488).

---

## 2. Keyboard map

From the Textpack 4 keyboard template, ORG p.35 (rendered), with key descriptions ORG p.36-44. A legend
below the dividing line on the template means *hold CODE*. CONTROL is a separate modifier (ORG p.333).

### 2.1 Left function cluster (two columns of four keys)

| Key | Alone | With CODE | Source |
|---|---|---|---|
| MATH REQUEST | MATH REQUESTS menu | CONSTNT (enter a math constant) | ORG p.35-36 |
| COLUMN ADD | Add decimal-aligned number to total, move down (typematic) | ROW ADD (typematic) | ORG p.37, p.433-434 |
| + | Add cursored number to total | x Multiply | ORG p.36 |
| - | Subtract | ÷ Divide | ORG p.37 |
| CONTROL | modifier | (none) | ORG p.36, p.333 |
| KEY PLAYBCK | Play back saved keystrokes | KEY SAVE (start/stop saving) | ORG p.37, p.411-413 |
| REQST | TEXTPACK REQUEST TASKS menu | CANCL | ORG p.35-36, p.259 |
| PRINT | Print the displayed page | KYB CHG (keyboard change) | ORG p.37, p.422 |
| END | End task/document | SCREEN FORMAT menu | ORG p.36-37, p.508 |
| MSG | Show/clear queued messages | REPLY (refuse an Insert Diskette request) | ORG p.37, p.499 |

### 2.2 Typewriter section (CODE functions only; unshifted/shifted keys type characters)

| Key | With CODE | Source |
|---|---|---|
| 8 | INSERT/REPLACE (toggle) | ORG p.35, p.400 |
| 9 | STOP (stop code) | ORG p.35, p.521, p.561 |
| BACKSPACE | REQD BKSP (required backspace) | ORG p.35, p.39, p.499 |
| TAB | REQD TAB (required/indent tab) | ORG p.35, p.38 |
| Y | 1/2 up (half index up, superscript) | ORG p.35, p.544 |
| U | BEGIN UND | ORG p.35, p.542 |
| I | WORD UND | ORG p.35, p.541 |
| H | 1/2 down (half index down, subscript) | ORG p.35, p.544 |
| J | END UND | ORG p.35, p.542 |
| K | SWITCH (switch code) | ORG p.35, p.528 |
| L | NEXT VARIABL | ORG p.35, p.480 |
| ; | VARIABL | ORG p.35, p.553 |
| C | CTR (centre) | ORG p.35, p.260 |
| M | Separator character between document name and diskette name on the prompt line (shown as an underlined comma) | ORG p.35, p.38, p.447 |
| Space bar | REQUIRED space | ORG p.35, p.506 |
| RETURN | Carrier return of the other kind (regular or required, per WORK STATION DESCRIPTION) | ORG p.247, p.505-506 |
| hyphen | Hyphen of the other kind (syllable or required, per WORK STATION DESCRIPTION) | ORG p.247, p.396 |
| ENTER | Switch between alternate tasks 1 and 2 (only with Alternate Tasks = Yes) | ORG p.253 |
| INDEX | Index Return **[INFERRED]** from "INDEX (coded)" cancelling an indent (ORG p.537) and the Index Return code (ORG p.560) | |

| Key | With CONTROL | Source |
|---|---|---|
| Z | Substitute code (also used as a FIND argument) | ORG p.333, p.527-528 |
| RETURN | Zero Index Carrier Return (ZICR); on the TASK SELECTION menu, CONTROL+RET then ENTER re-IPLs | ORG p.333, p.553-554 |

Other single keys in this section: TAB, RETURN, BACKSPACE, INDEX, LOCK, SHIFT (x2), CODE, ENTER (to the
right of the space bar; TP4note warns it is not the Return key), the `1/4 1/2` key and the `[ ]` key.
Character underline is SHIFT + the underline key (ORG p.541) **[UNCLEAR]** which physical key; on the
96-character template the underscore shares the `-` key (ORG p.35 rendered).

### 2.3 Right upper cluster (editing)

| Key | Alone | With CODE | Source |
|---|---|---|---|
| DELETE (DEL) | Delete | OVERSTRIKE | ORG p.35, p.41, p.483 |
| MOVE | Move | COPY | ORG p.35, p.41, p.339 |
| LINE ADJUST | Adjust the cursored line (repeat-action) | (none) | ORG p.35, p.41, p.424, p.591 |
| SPELL | Load Spelling Tasks / FIND argument for highlighted words | (none) | ORG p.35, p.41, p.519 |
| CHANGE FORMAT (CHG FMT) | FORMAT SELECTION menu at cursor | INSTRUCTION (INSTR) | ORG p.35, p.42, p.402 |
| GET | GET menu | (none) | ORG p.35, p.42, p.385 |
| PAGE END | Temporary page end | REQUIRD (required page end) | ORG p.35, p.42, p.499 |
| COLUMN | Column functions | LAYOUT | ORG p.35, p.42 |

### 2.4 Right lower cluster (cursor and screen)

| Key | Alone | With CODE | Source |
|---|---|---|---|
| Cursor Up | Up one line | Boundary Up: to beginning of displayed page | ORG p.43 |
| Cursor Down | Down one line | Boundary Down: to end of displayed page | ORG p.43 |
| Cursor Left | Left one position | Boundary Left: to beginning of line, left margin or temporary left margin | ORG p.43 |
| Cursor Right | Right one position | Boundary Right: to last character of the line | ORG p.44 |
| FIND | Find | GLOBAL (replace/delete menu) | ORG p.44, p.387 |
| GO TO | Go to page | MENU BYPASS | ORG p.44, p.445 |
| SCREEN DOWN | Screen down | SCREEN UP | ORG p.44, p.510-511 |
| SCREEN RIGHT | Screen right | SCREEN LEFT | ORG p.44, p.509-510 |

In Key-To-Print the cursor keys move the print element and the boundary keys micro-space/micro-index
(ORG p.43-44); out of scope here.

### 2.5 Typematic keys
Only COLUMN ADD and ROW ADD are called typematic (ORG p.433-434, glossary p.595). LINE ADJ is
"repeat-action for multi-line adjusting" and TB2 has the operator hold it down (ORG p.591; TB2 p.579-580).
No repeat delay or rate is given anywhere **[NOT IN ORG]**. Whether character keys or cursor keys repeat
is not stated **[UNCLEAR]**.

---

## 3. Global interaction model

### 3.1 Menus (ORG p.64-67)
- A menu has a centred name, an ID / ITEM table (optionally YOUR CHOICE and POSSIBLE CHOICES columns) and
  an information area ending in the prompt.
- Standard prompts:
  - `Type ID letter to choose ITEM; press ENTER:` (cursor `_` follows) (ORG p.128, p.233, many)
  - `When finished with this menu, press ENTER.` (ORG p.65)
  - After an ID is entered on a menu with a YOUR CHOICE column: `Type YOUR CHOICE; press ENTER` (ORG p.66;
    TB2 p.135 shows `Type YOUR CHOICE; press ENTER`).
- **Long form:** ID, ENTER, value, ENTER. **Short form:** ID, space, value, ENTER (e.g. `a 2` ENTER)
  (ORG p.66, p.257).
- A changed choice is highlighted. ENTER on the `Type ID letter...` prompt with no ID commits all
  highlighted changes; invalid choices produce an error message that stays until the menu is cancelled
  or the choice is corrected (ORG p.65). An item left alone keeps YOUR CHOICE (ORG p.65).
- Menus with no YOUR CHOICE column (TASK SELECTION, TYPING TASKS, FORMAT SELECTION...): ID + ENTER goes
  to the next menu (ORG p.66).
- Leaving a menu: task completion, cancelling, END, CANCL or ENTER. Request, Format Change and
  Instruction menus return to where you were when you pressed the key (ORG p.67).

### 3.2 CANCL as an undo stack (ORG p.66, p.259)
Each CANCL removes one level, in this order: (1) the answer typed to a prompt, (2) the prompt itself,
(3) all menu choices made (highlighting removed), (4) the current menu. In editing functions: first
CANCL clears the typed answer (e.g. FIND argument), second cancels the function (ORG p.382). CANCL also
cancels MOVE, COPY, DEL, GO TO, OVERSTRIKE, FIND, GET, KYB CHG and Math; clears SPELL highlighting on the
cursored word; ends the Create/Update Combined Program Diskette tasks (ORG p.259).

### 3.3 Batch menu access (ORG p.256-257)
Keystrokes are buffered: the operator may type ID letters and ENTERs for menus that have not appeared yet
and the system applies them in order. Example from TYPING TASKS: `f` ENTER, `b` ENTER, `b` ENTER reaches
DUPLICATE DOCUMENT. Implementation: a keystroke queue consumed by each screen as it becomes ready,
never discarded during screen transitions.

### 3.4 Menu Bypass (CODE + GO TO) (ORG p.445-448, list ORG p.85-86)
- Prompt: `Type Abbreviation; Press ENTER.` Operator types a keyword or short form, optionally with
  arguments, ENTER.
- If the target is in another task, the system ends the current document, loads the needed program
  segment and shows the menu (e.g. `dupdoc` from the typing area). Instruction abbreviations insert the
  instruction directly (e.g. `begkeep`).
- `create <name>` / `revise <name>` go straight to that document's CREATE OR REVISE DOCUMENT menu; with
  two work diskettes loaded the system asks for the diskette unless typed as `<name>` + separator
  (CODE+M) + `<diskette>` (ORG p.446-447).
- Not allowed: from TASK SELECTION, TEXTPACK PROGRAM DISKETTE TASKS or PROGRAM DISKETTE TASKS menus, for
  program diskette items, for feature tasks. Not allowed at the current position (e.g. a line format
  change with the cursor not at the left margin) gives `(abbreviation) not allowed at this time.`
  (ORG p.446).
- Short forms are user-changeable, limited to six characters (ORG p.287, p.190).

| Keyword | Short | Target | | Keyword | Short | Target |
|---|---|---|---|---|---|---|
| create | c | Create Document | | docname | dcn | Change Document Name |
| index | i | Display Index | | diskname | dkn | Change Diskette Name |
| paginate | pg | Paginate Document | | condisk | cdk | Condense Diskette |
| print | p | Print Document | | deldoc | xdc | Delete Document |
| revise | r | Revise Document | | dupdisk | ddk | Duplicate Diskette |
| althf | ahf | Alternating Header/Footer | | dupdoc | ddc | Duplicate Document |
| begkeep | bk | Begin Keep | | erasedisk | e | Erase or Initialize Diskette |
| altfmt | af | Begin Using Alternate Format | | printindex | pi | Print Index |
| docfmt | dcf | Begin Using Document Format | | recover | rec | Recover Document |
| codeno | cdn | Display Codes = No | | printorder | po | Change Printing Order |
| codeyes | cdy | Display Codes = Yes | | contprint | ctp | Continue Printing With Element Now on Printer |
| endkeep | ek | End Keep | | canprint | cp | Display Print Queue or Cancel Print Job |
| get | g | Get | | relptr | rlp | Release Printer |
| global | gl | Global Replace/Delete | | reqptr | rqp | Request Printer |
| hf | hf | Header and Footer | | startptr | stp | Start Printer |
| include | inc | Include | | begspell | bsp | Begin Spelling Check |
| linefmt | lf | Line Format | | chkdoc | cd | Check Document |
| martab | mt | Margins and Tabs | | langdic | lgd | Choose Spelling Language Dictionary |
| type | ty | Mid-Line Typestyle | | clearsup | clr | Clear Supplement |
| pgfmt | pf | Page Format | | endspell | esp | End Spelling Check |
| pgnum | pn | Page Number | | lang | lg | Language for Spelling Check |
| retfmt | rf | Return All Formats to Starting Choice | | loadsup | ld | Load Supplement |
| retlinefmt | rlf | Return Line Formats, Margins & Tabs | | storesup | sto | Store Supplement |
| return | rt | Return to typing area or CREATE/REVISE DOCUMENT menu | | mergevar / mergesw | mv / msw | Merge tasks |
| rettype | rty | Return Typestyle to Starting Choice | | (files: endif eif, filerep f, ifempty ife, ifnotempty ifn, math m, multicol mc, skip stl, summath sm) | | |
| sysnum | sn | System Page Number | | | | |

OCR read `If`, `rIp`, `19d`, `cIr`, `19`; corrected to `lf`, `rlp`, `lgd`, `clr`, `lg` **[INFERRED]** (l/1/I confusion).

### 3.5 Messages and the message queue
- Messages go to the message line; when several are pending a blinking arrow shows; MSG displays the next
  and clears it (ORG p.480). REPLY (CODE+MSG) answers an Insert Diskette message with "will not insert",
  cancelling the task that needed the diskette; then MSG clears the message (ORG p.499).
- Some messages are "queued" rather than shown (e.g. the key-save reminder, ORG p.411; supplement written,
  ORG p.345).
- With Alternate Tasks, messages carry `1=>` or `2=>` for their task and are erased by the next keystroke
  unless MSG is pressed (ORG p.253).

### 3.6 Keystroke buffering during disk work
Not stated beyond batch menu access **[UNCLEAR]**. Assume keystrokes queue while the system is busy.

---

## 4. Editing functions: per-function behaviour

The editor works on one page of one document at a time in the typing area. Positions are "under" a
character: the cursor sits on the character it will act on. Insert mode is the normal state.

### 4.1 Typing, Insert and Replace
- **Insert mode** (default): typed text goes in at the cursor and following text moves out (ORG p.252,
  p.39). **Replace mode**: typing overwrites (ORG p.39, p.400). INSERT/REPLACE (CODE+8) toggles; status
  field C shows the mode (ORG p.29). Default after IPL: Insert **[INFERRED]** (ORG p.252 treats Replace as
  the exception).
- **Auto Carrier Return / Auto Adjust = On** (WORK STATION DESCRIPTION default 1): a word that would pass
  the right margin gets a carrier return inserted before it and moves to the next line (word wrap); text
  re-adjusts between margins as you insert or delete (ORG p.254, p.247). These system carrier returns are
  the movable kind.
- **Auto CR = Off:** the operator must type RET at each line end; a short beep sounds on entering the zone
  (Zone Width before the right margin) (ORG p.53, p.254). Lines re-flow only by LINE ADJ or pagination.
- If you type past the page length, the short beep sounds at the Last Typing Line; text is not split onto
  a new page until you type a Page End or paginate (ORG p.252, p.53, p.488).
- Lines where copied/moved text lands are not re-adjusted automatically (ORG p.340, p.477).

### 4.2 Carrier returns (RET, CODE+RET)
Two codes: **carrier return** (regular, movable by adjust/pagination) and **required carrier return**
(never moved; also cancels an indent level) (ORG p.505-506, p.559-560).

| WORK STATION DESCRIPTION "Required Carrier Return" | RET gives | CODE+RET gives |
|---|---|---|
| 1 = Coded | regular CR | required CR |
| 2 = Non-Coded (default) | required CR | regular CR |

ORG p.246-247, p.505-506. With Non-Coded and Auto CR On the operator presses RET only at paragraph ends
and the system supplies the wrap returns (ORG p.506). The how-to procedures assume Auto CR On, required CR
Non-Coded, required hyphen Non-Coded (ORG p.251).

Other line-ending codes: **Index** (INDEX key; print position moves down a line without carriage return;
on screen the cursor goes to the left margin of the next line only if it was at the left margin) (ORG
p.39-40, p.559); **Index Return** (returns to left margin and cancels a required tab) (ORG p.560);
**ZICR** (CONTROL+RET: on screen goes to next line at the left margin; prints as a return with no line
feed, for overprinting) (ORG p.333, p.553).

### 4.3 Hyphens (ORG p.395-396, p.247)
- **Syllable hyphen** (regular): may be removed and the word rejoined by pagination, dictionary
  hyphenation or LINE ADJ; shown/printed only when it ends a line (ORG p.562).
- **Required hyphen**: permanent part of the word (e.g. `348-3382`); never removed.
- Key mapping by WORK STATION DESCRIPTION "Required Hyphen": 1 = Coded (hyphen key = syllable, CODE+hyphen
  = required); 2 = Non-Coded, default (hyphen key = required, CODE+hyphen = syllable).

### 4.4 Required space (CODE + Space) (ORG p.506, p.561)
A space that keeps the words on each side on one line through adjust and pagination, and that WORD UND
treats as part of the word. Stored as its own code (symbol section 5).

### 4.5 Tabs (TAB, CODE+TAB)
- TAB inserts a tab code and moves to the next tab stop; alignment follows the stop's type. Alignment works
  only when the stop is reached with TAB, not by spacing (ORG p.38, p.533).
- **Left (normal):** left edge at the stop. **Decimal:** characters build leftward from the stop until a
  `.` is typed, then rightward; a whole number stays entirely left of the stop. **Comma:** same with `,`.
  **Colon:** same with `:`. **Centre:** text centres on the stop as typed. **Right:** text builds leftward,
  right edge at the stop (ORG p.533-536).
- **REQD TAB (CODE+TAB):** indent tab; each one moves the temporary left margin to the next stop, so wrapped
  lines align there. Up to 15 indent levels (ORG p.536). The indent is cancelled by RET (paragraph end,
  with Auto CR on), INDEX (coded), REQD PAGE END, a page or line format change, Begin Using Document or
  Alternate Format, Return Line Format, Return All Formats (ORG p.536-537), and by a required carrier
  return or index return (ORG p.560).

### 4.6 BKSP and REQD BKSP
- **BKSP** deletes the character to the left of the cursor; repeated presses continue; ignored at the left
  margin (ORG p.258). It will not delete these codes (use DEL): required RET, Index, Page End, Required
  Page End, format change, return-format codes, instructions, Begin/End Und, Spelling Mark Begin/End,
  Spelling Language, Begin/End Spelling, Begin/End Table, Begin/End Keep, Include (ORG p.258) **[INFERRED]**
  BKSP stops (does nothing) when the character to the left is one of these.
- In menus/prompts BKSP erases the last typed character (ORG p.32, p.382).
- **REQD BKSP (CODE+BKSP)** moves cursor and print position one position left without deleting, to build
  overstruck composite characters: type text, then exactly that many REQD BKSPs, then the overstriking
  characters. On screen sometimes only the overstriking character shows (ORG p.39, p.499, p.560).

### 4.7 Cursor and screen movement
| Key | Effect | Source |
|---|---|---|
| Up / Down | One line; scroll at screen edge | ORG p.32, p.43 |
| Left / Right | One position; segment horizontally at screen edge | ORG p.32, p.43-44 |
| Boundary Up (CODE+Up) | Beginning of the displayed page | ORG p.43 |
| Boundary Down (CODE+Down) | End of the displayed page; also a DEL/COPY extent "through end of page" | ORG p.43, p.354 |
| Boundary Left (CODE+Left) | Beginning of line / left margin / temporary left margin | ORG p.43 |
| Boundary Right (CODE+Right) | Last character of the line | ORG p.44 |
| SCREEN RIGHT | Left edge of screen moves to the cursor column; if the cursor is already at the left edge, screen moves 60 positions right and cursor stays at the left edge | ORG p.509 |
| SCREEN LEFT (CODE+SCREEN RIGHT) | Right edge of screen moves to the cursor; if that is impossible, to the document's left boundary | ORG p.510 |
| SCREEN DOWN | Cursored line becomes first screen line; if cursor already on the first line, the last screen line becomes the first; moves to the next page if a page end is on screen | ORG p.510-511 |
| SCREEN UP (CODE+SCREEN DOWN) | Cursored line becomes last screen line; stops at top of page; can move to the bottom of the previous page | ORG p.511 |

Moving between pages with the cursor keys past a Page End is implied (Down from the last line shows the
next page) but not described **[UNCLEAR]**.

### 4.8 The selection pattern: DEL, MOVE, COPY, OVERSTRIKE (ORG p.339-355, p.477-487)
All four share one state machine:

1. **Idle.** Operator puts the cursor under the first character of the text (any cursor key, FIND, GO TO).
2. **Press key** -> prompt `Delete what?` / `Move what?` / `Copy what?` / `Overstrike what?`. Status
   field A shows the function (e.g. `Copy Text`, ORG p.558).
3. **Extend the highlight** to the last character. The text from the start position to the cursor is
   highlighted as it grows. Ways to extend (ORG p.352-355):
   - ENTER at once: just the one character.
   - Cursor keys, FIND (with its own prompt), GO TO (to another page).
   - **Type a character**: the cursor jumps to the next occurrence of that character; repeat to go further
     (ORG p.355). So a **space** extends to the end of the word plus its following space, one word per
     space (ORG p.352-353); **RET** extends to the next carrier return (short line/last line of paragraph);
     **CODE+RET** extends one full line within a paragraph (ORG p.354); **PAGE END** or **Boundary Down**
     extends through the end of the page (ORG p.354).
   - **COLUMN** selects the table column containing the cursor (ORG p.340, p.351, p.478).
4. **ENTER** confirms the extent.
   - DEL: highlighted text is removed; done.
   - MOVE / COPY: prompt `To where?`; operator moves the cursor to the destination and presses ENTER. Text
     is inserted before the cursor; for MOVE it is removed from the source. Cursor ends under the first
     character of the moved/copied text (ORG p.339-340, p.477).
   - OVERSTRIKE: prompt `Overstrike with what character?`; operator types one character, ENTER. Text is
     bracketed by Begin/End Overstrike codes and shows with the overstrike character once the cursor moves
     (ORG p.483-484, p.558-559).
5. CANCL at any step: first clears the current answer, then cancels the function (ORG p.259).

Notes: MOVE/COPY are within the same document (GET for other documents). Moved/copied lines are not
re-adjusted (ORG p.340, p.477). Deleting a column then needs LAYOUT to re-space (ORG p.351). The last Page
End of a document cannot be deleted (ORG p.489). Overstrike text can be found with FIND then OVERSTRIKE as
the argument (ORG p.488). Whether DEL extents may span pages is implied by GO TO in step 3 (ORG p.355-356).

### 4.9 FIND (ORG p.380-382)
1. FIND -> prompt (TB2 and ORG p.488: `Find what?`). Previous argument is kept: pressing ENTER at once
   finds the next occurrence of the last argument (ORG p.353, p.488).
2. Type up to 60 characters; exact match (case, spaces, hyphens, punctuation). Allowed as argument:
   letters, digits, REQD TAB, SPACE, REQUIRED SPACE, REQD BKSP, RET (both kinds), HYPHEN (both kinds), half
   index up/down, CHG FMT, INSTR, PAGE END and REQD PAGE END (each ends the argument; FIND will not search
   across them if typed), WORD UND, STOP, OVERSTRIKE, SWITCH, BEGIN/END UND, LAYOUT, VARIABL, INDEX, SPELL
   (= a spell-highlighted word), CONTROL+Z (substitute code). BKSP or CANCL to correct.
3. ENTER: search **forward only** from the cursor; the cursor lands on the first character of the match.
4. FIND, ENTER again for the next one. CANCL clears the answer, CANCL again cancels; CANCL also stops a
   search in progress.
Not-found behaviour and message are not described **[UNCLEAR]**.

### 4.10 GLOBAL (CODE+FIND) (ORG p.163, p.387-393)
GLOBAL REPLACE/DELETE menu:

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Kind Of Search | 2 | 1 = Prompted, 2 = Automatic |
| b | Kind of Match | 1 | 1 = Word, 2 = Exact Character |
| c, e, g | Search For: | blank | up to 60 characters |
| d, f, h | Replace With: | blank | up to 60 characters; blank = delete |

- **Word** match: case-sensitive, whole words only (`his` -> `hers` changes `his.` and `(his)`, not `history`,
  `chisel`, `this`). **Exact Character**: substring match (`boat`->`ship` also changes `boats`, `boating`)
  (ORG p.388-389).
- Up to three pairs, typically used for lower/UPPER/Initial-cap variants (ORG p.390).
- Search starts at the cursor position when GLOBAL was pressed and goes forward only (ORG p.390).
- **Prompted:** stops on each match, highlighted, cursor on its first character; prompt `Press ENTER to
  replace or delete, or press CANCL.` ENTER replaces, then `Press ENTER to continue search.`; CANCL then
  ENTER skips. The operator may CANCL once to unhighlight, revise text by hand, then ENTER to continue from
  the cursor (Math and Column functions unavailable meanwhile). CANCL then GLOBAL reopens the menu with
  its entries (ORG p.390-392).
- **Interrupting:** CANCL during a search stops at the next match or at the end of the current page
  (cursor under the Page End); Automatic switches to Prompted. Then ENTER resumes, CANCL cancels, GLOBAL
  reopens the menu (ORG p.392-393).
- End messages: Prompted `Global Replace/Delete completed. (number) phrases changed.`; Automatic
  `Global Replace/Delete completed. (number) phrases found.` (ORG p.391-392; TB2 p.135 shows "phrases
  changed" for an automatic run **[UNCLEAR]** which word goes with which mode); none found:
  `No phrases found. Global Replace/Delete completed.` (ORG p.393).
- Removing spell highlighting: Exact Character, Search For = SPELL key, Replace With blank (ORG p.393).
- Allowed argument keys as FIND, plus REPEAT (ORG p.389-390).

### 4.11 GO TO (ORG p.393-394)
GO TO -> prompt `Type page number; press ENTER` (TB2 p.112, p.117). Type a system page number (e.g. `3`,
`1.1`), ENTER: that page is displayed, cursor under its first character. ENTER with no number: the next
page. A page number that does not exist: the last Page End code or the last character of the last page.

### 4.12 GET (ORG p.162, p.385-387)
Copies pages of another (or the same **[UNCLEAR]**) stored document into the current one at the cursor.
GET menu: a Document Name, b Diskette Name, c System Page Number(s) (space-separated; blank = whole
document), d Insert Included Text (2 = No default; 1 = Yes copies the text that Include instructions refer
to instead of the instructions). Single diskette unit: only from the loaded diskette. The inserted pages'
Page End codes are removed, so several pages arrive as one page; paginate afterwards. Copied pages take the
current document's format unless they contain format changes. One source document per GET. Cursor ends
under the first inserted character.

### 4.13 CHG FMT (format change inside a document) (ORG p.157-159, p.302-303, p.384-385)
The menu offered depends on the cursor position when CHG FMT is pressed:

| Cursor at | FORMAT SELECTION items |
|---|---|
| First character position of a page | a Change Line Format, b Change Margins and Tabs, c Change Page Format, d Change Header and Footer, e Change Alternating Headers and Footers, f Return All Formats to Starting Choice, g Return Line Format, Margins and Tabs to Starting Choice, h Return Typestyle to Starting Choice, i Begin Using Document Format, j Begin Using Alternate Format |
| First position of any other line | a Change Line Format, b Change Margins and Tabs, c Return Line Format, Margins and Tabs to Starting Choice, d Return Typestyle to Starting Choice |
| Within a line | Typestyle Number (same pitch only), Return Typestyle to Starting Choice |

- Changes apply from the cursor to the next change or end of document; earlier text is unaffected. On
  return the system inserts a format change code (boxed `F`, section 5) and puts the cursor back where it
  was (ORG p.303). Return codes show as a boxed `R`; Begin Using Alternate Format as a boxed `2`.
- To review or revise a change: cursor under the symbol, ENTER, edit the menus, ENTER back (ORG p.385).
- Several changes can accumulate at one position; the cursor does not advance across a second one
  (test: move right from the first; if the cursor does not move, another exists). Advice: delete them all
  and make one combined change (ORG p.384-385).
- In Revise, paginate afterwards so changes take effect across pages (ORG p.274, p.385).
- Change pitch before margins/tabs to avoid misalignment (ORG p.426).
- Not allowed in alternating header/footer text (ORG p.267).

### 4.14 INSTR (CODE + CHG FMT) (ORG p.174-175, p.402-409)
INSTRUCTIONS menu in a document: a Begin Keep, b End Keep, c Include, d Math, e File Report Instructions,
f Multi-Column File Listing, g Summary Math, h Conditional Text: Field or Variable Empty, i Conditional
Text: Field or Variable Not Empty, j End of Conditional Text, k Skip to Line, l Begin Spelling Check,
m End Spelling Check, n Language For Spelling Check. Choosing inserts the instruction at the cursor and
returns to the text (some open a sub-menu).
- **Begin/End Keep**: the bracketed text is not split by pagination; if it does not fit, it starts a new
  page (ORG p.175).
- **End/Begin Spelling Check**: text between End and Begin is not spell checked or dictionary-hyphenated
  (ORG p.402-403, p.516-517).
- **Include**: document, diskette, up to 10 page numbers (blank = all); prints the included pages; ENTER on
  the symbol reopens its menu (ORG p.403-404).
- **Skip to Line**: prompt `Skip to what line number?`; whole number or .5; must exceed the current line and
  not exceed the Last Typing Line; line spacing 1 or 1/2 (ORG p.408).
- In header/footer text the INSTRUCTIONS menu offers **Page Number** (optionally a value to reset to) and
  **System Page Number** (ORG p.409, p.489). Revising one: delete the old symbol first, else both print
  (e.g. `22`) (ORG p.409).
- In a file Text Field only Include is allowed (ORG p.409).

### 4.15 PAGE END and REQD PAGE END (ORG p.42, p.488-489, p.499-500)
- **PAGE END**: a temporary page end; pagination may move it. Typing one ends the page; the cursor goes to
  a new page **[INFERRED]** (REQD PAGE END is documented as *not* doing so). Symbol: filled triangle. The
  last Page End of a document cannot be deleted (ORG p.489); every document therefore ends with one.
- **REQD PAGE END (CODE+PAGE END)**: page always ends here in pagination; ejects the page in printing; the
  cursor does **not** go to a new page; type a PAGE END after it to start one. DEL removes it (ORG p.499-500).
  Also cancels indent levels and ends centring.
- If no page ends are typed, pagination inserts them after the Last Typing Line (ORG p.488-489).

### 4.16 Centre (CODE+C) (ORG p.260-262)
Space or tab to the centre point (scale-line centre mark for the line), press CTR, type: text centres on
that point as typed. Centring ends at REQUIRED RET, INDEX, PAGE END, REQD PAGE END or REQD TAB. Centre
tabs give the same effect at tab stops (ORG p.261).

### 4.17 Underlining (ORG p.540-545)
- **Character underline:** after typing a character, SHIFT+underline key underlines it; only the underline
  shows on screen (ORG p.540-541).
- **WORD UND (CODE+I):** typed after a word, underlines backward from the cursored position to the
  previous SPACE, RET, REQD TAB, INDEX, PAGE END, REQD PAGE END or REQD BKSP. REQUIRED SPACE, STOP and
  hyphens do not stop it. During revision put the cursor on the space after the word and press WORD UND
  (ORG p.541-542). Symbol `xx` over a line.
- **BEGIN UND (CODE+U) / END UND (CODE+J):** continuous underline between the codes; in revision, text after
  an unmatched BEGIN UND shows underlined to the end of the page until END UND is placed (ORG p.542).
- Double underline by half-index tricks or the `=` key (ORG p.544).

### 4.18 Half index (CODE+Y up, CODE+H down) (ORG p.394)
Moves text half a line up or down; pair them to return to the base line. Only one level each way displays
or prints.

### 4.19 LINE ADJ and hyphenation decisions (ORG p.395, p.424, p.554; TB2 p.579-580)
- Adjusts the cursored line between the margins (if Adjust Line Endings = Yes). Held down it keeps
  adjusting successive lines (repeat-action).
- If a word crosses the right margin and no break falls inside the zone, adjusting stops: cursor under the
  first character of the word, prompt `Hyphenate where?` (TB2 p.579). Operator responses (ORG p.395):
  - leave cursor at the word start, ENTER: whole word to next line;
  - move cursor right of the last character (punctuation counts), ENTER: word stays on this line;
  - move cursor to the character after the hyphen point, ENTER: system inserts a hyphen and carrier
    return.
- END abandons hyphenation decisions (TB2 p.585).
- Zone Width 1-30 (default 6): smaller zone = more hyphenation decisions, straighter margin.

### 4.20 Justification (Line Format "Line Alignment") (ORG p.283, p.410)
1 Left (ragged right, prints as displayed); 2 Justify (spare spaces distributed between words, alternately
from the left on one line and the right on the next); 3 Half-Justify (half the spare spaces, same
alternation). Lines ending with a required CR followed by REQD PAGE END are not justified. Justification
affects printing; the 25-line screen shows unjustified text **[INFERRED]** from "Text prints as it appears
on the display" being said only of Left (ORG p.283).

### 4.21 Stop, Switch, Variable, Substitute codes
- **STOP (CODE+9):** a stop code for manual fill-in in repetitive documents and mag-card compatibility;
  shown as a filled square, named `Stop` (ORG p.521, p.561). Print-time pause behaviour is in the WSPG, not
  ORG **[NOT IN ORG]**.
- **SWITCH (CODE+K):** mag-card compatibility code (ORG p.528).
- **VARIABL (CODE+;):** prompt `Type variable name; press ENTER` then inserts a variable name (1-16
  characters) (ORG p.449, p.464). **NEXT VARIABL (CODE+L)** jumps past the next variable name, across Page
  Ends (ORG p.480).
- **Substitute code (CONTROL+Z):** stands for an unprintable/unknown character; inserted by Recover
  Documents and on keyboard mismatches; prints as an underline (ORG p.239, p.527-528, p.561).

### 4.22 KYB CHG (CODE+PRINT) (ORG p.422-423)
Prompt `Type new keyboard number; press ENTER` (TB2 p.548). Number must be one of the home keyboard and the
five alternates on the program diskette. Inserts a Keyboard Change code (filled square) and returns the
cursor. Status `Kyb n` changes. Stays in force for the rest of the program load, across documents. On a
92-key keyboard, a 96-key arrangement's four extra keys are unusable.

### 4.23 SCREEN FORMAT (CODE+END) (ORG p.226, p.508)
Menu with a single item: a Display Codes, default 2 (No); 1 = Yes. Only during Create/Revise, not while a
format change or Request Task is active.

### 4.24 Keystroke Save / Playback (ORG p.411-413)
- KEY SAVE (CODE+KEY PLAYBCK): enters save mode, the message arrow `==>` flashes, `Save` shows on status 1,
  a reminder message is queued. Up to 250 keystrokes. All keys are saved except MSG and KEY PLAYBCK; BKSP
  corrections are saved too. KEY SAVE again stops (arrow stops flashing). Starting a new save discards the
  previous one.
- KEY PLAYBCK: `Play` on status 1; replays the keystrokes; CANCL stops; next PLAYBCK starts from the
  beginning.
- The saved keystrokes are lost on Go To Task Selection from TYPING TASKS or pressing SPELL.

### 4.25 PRINT key (ORG p.494-495)
In Create/Revise: stores the current page, inserts a Page End if needed, queues one copy of that page and
moves to the next page. Up to 25 pages queued this way.

### 4.26 SPELL key (ORG p.519-520)
Ends the document, shows TASK SELECTION with Spelling Tasks highlighted, then SPELLING TASKS with Check
Document highlighted, with the document name already on the prompt line; ENTER -> CHECK DOCUMENT menu.
After an automatic check it walks back: TASK SELECTION (Typing Tasks highlighted), TYPING TASKS (Revise
Document highlighted), name on the prompt line; ENTER revises. In text, FIND then SPELL then ENTER moves to
the next highlighted (unrecognised) word; CANCL removes highlighting from the cursored word.

### 4.27 END (ORG p.372-373)
- Ends Create/Revise from the CREATE OR REVISE DOCUMENT menu or the typing area; document is stored;
  TYPING TASKS menu shows (ORG p.67). Not allowed while a format change, REQUEST TASKS menu, instruction
  menus, MOVE/COPY/DEL, GO TO/FIND/GET, LINE ADJ, SCREEN FORMAT, KYB CHG, GLOBAL, MATH REQUEST or column
  work is active: CANCL first.
- Cancels pagination in progress.
- Ends other tasks during setup; refused while duplicating, deleting a document, duplicating a diskette or
  program diskette, erasing/initializing, renaming a diskette or document, condensing.
- On menus with a destructive ENTER (Duplicate/Condense/Erase), END before ENTER stops (ORG p.332, p.364, p.376).

### 4.28 ENTER (ORG p.374)
Commits a menu choice; advances to the next menu; submits a prompt answer; continues to the next step;
with the cursor on a format change (or variable, include, etc.) displays it.

### 4.29 REQST (ORG p.238-239, p.500-501)
TEXTPACK REQUEST TASKS menu, available everywhere except Program Diskette Tasks: a Print Document, b Display
Print Queue or Cancel Print Job, c Change Printing Order, d Display Index of Diskette Contents, e Continue
Printing With Element Now On Printer, f Request Printer, g Release Printer, h Start Printer. Returns to
where you were after ENTER.

---

## 5. Stored control codes and their display symbols

Appendix B, ORG p.558-562 (rendered and checked). When the cursor is under any of these, its *Function* name
appears in status field E. DEL removes any of them. "Shown" = with Display Codes = No, only when cursored;
with Yes, always. Glyphs are described in words because the manual's symbols are custom.

| Code (status-line name) | How entered | Display symbol | Notes |
|---|---|---|---|
| Carrier Return | RET / CODE+RET per WSD | bent arrow: down then left, return-key shape | to left margin or temporary left margin |
| Req'd Carrier Ret | RET / CODE+RET per WSD | same bent arrow with a small horizontal bar/hook on top (heavier) | cancels required tab |
| Index | INDEX | vertical stroke with two short crossbars and a down arrowhead | line feed only |
| Index Return | CODE+INDEX [INFERRED] | left-pointing return arrow with a small double-dagger mark at its top right | cancels required tab |
| Zero Index RET | CONTROL+RET | left arrowhead with a double crossbar (left-pointing arrow over `++`) | CR without line feed |
| Tab | TAB | right arrow ending at a vertical bar `→|` | |
| Req'd Tab | CODE+TAB | `→|` with a small down-pointing triangle above the arrow | sets temporary left margin |
| Required Space | CODE+Space | filled down-pointing triangle | |
| Required Hyphen | hyphen per WSD | filled down-pointing triangle on a short base line | |
| Syllable Hyphen | hyphen per WSD | short dash (hidden unless it ends a line) | |
| Req'd BKSP | CODE+BKSP | left arrow with a small filled triangle above | |
| Page End | PAGE END | filled up-pointing triangle | last character of the page |
| Required Page End | CODE+PAGE END | hourglass (down triangle over up triangle) | |
| Half Index Up | CODE+Y | vertical stroke with a small flag/arrowhead at the top | |
| Half Index Down | CODE+H | vertical stroke with a small arrowhead at the bottom | |
| Ctr | CODE+C | dot between two vertical bars `|•|` | |
| Begin Und | CODE+U | right arrow with a small `x` above | |
| End Und | CODE+J | left arrow with a small `x` above | |
| Word Und | CODE+I | `xx` over a line | |
| Und (character underline) | underline key | long dash/underline | |
| Begin Overstrike / End Overstrike | OVERSTRIKE | two short dashes over a right arrow / over a left arrow | |
| Begin Keep / End Keep | INSTR | `++` (double-crossed stroke) over a right arrow / over a left arrow | |
| Begin Table / End Table | Column Layout | same `++` over right / left arrow as Keep | |
| Begin Spelling / End Spelling | INSTR | double-cross mark `#`-like `++` (two vertical strokes crossed by two horizontals) | |
| Spelling Language: (x) | INSTR | `++` mark; name includes language ID letter | |
| Conditional Text, File Report Defin., Math, Multi-Column Head'g, Summary Math, System Pg. Number, Pg. Number, Pg. Number: (number) | INSTR | instruction symbol `++` (a horizontal stroke crossed by two short verticals, written `-++-` in the text) | use Display Codes = Yes to see detail |
| Include | INSTR | small slanted stroke crossed by a bar (like a struck-through `/`); with Display Codes = Yes followed by the INCLUDE menu choices; with No, the instruction symbol | ENTER shows menu |
| Line Format Change, Page Format Change, Typestyle Chg ( ) | CHG FMT | boxed `F` | ENTER shows it |
| Line Format Return, Page Format Return, Typestyle Return | CHG FMT "Return..." | boxed `R` | |
| Start Alternate Fmt | CHG FMT j | boxed `2` | |
| Variable | CODE+; | a `v`/`u`-shaped mark crossed by a bar | ENTER shows name |
| Keyboard Change | KYB CHG | filled square | |
| Stop | CODE+9 | filled square | |
| Switch | CODE+K | filled square | |
| Card Rept | CODE+1 [per ORG p.558] | filled square | mag-card repeat |
| Spelling Mark Begin / End | spell check | filled square | brackets a highlighted word |
| Substitute | CONTROL+Z / system | long dash | prints as underline |
| Null, Unassigned Code, BKSP 1, BKSP 6, Space 6 | foreign media | filled square | ignored/not honoured |
| Non-Typing Area | (cursor position) | none | right of a carrier return |
| Right Paper Edge | (scale line) | filled square on the scale line | last print position |

Scale-line marks (ORG p.183-184, p.533): left margin `«`, right margin `»`; tab stops: left/normal
shown as an underline mark, decimal `.`, comma `,`, centre `|-|` style mark, right `-|`, colon `:`
**[UNCLEAR]** exact glyphs (OCR damaged; render ORG p.184 / p.311 to confirm).

Where symbols appear on screen: a code occupies one character position in the line (inferred from "move
the cursor right; if it does not move, another Format Change exists", ORG p.385, which implies several
zero-width codes can share a position) **[UNCLEAR]**: some codes (format changes, keep, include) appear
to take no column, others (tab, required space, carrier return) take one. Recommend: printing codes
(characters, spaces, tabs, CR) take columns; non-printing instructions are zero-width when Display Codes
= No and one column when Yes (consistent with ORG p.508 "may cause some text to appear to be moved to the
right").

---

## 6. Prompts and messages (partial; numbers not available)

Exact wording as printed. `(x)` marks a variable part. Capitalisation follows the source; the source is
not always consistent (e.g. `Copy what?` vs `Copy What?`).

### 6.1 Prompts (prompt line)

| Wording | When | Operator response | Source |
|---|---|---|---|
| `Type ID letter to choose ITEM; press ENTER:` | Any menu with ID letters | ID letter (+ space + value), ENTER; or ENTER to finish; CANCL | ORG p.65, p.128 |
| `When finished with this menu, press ENTER.` | Above the ID prompt on menus with choices | ENTER to leave | ORG p.65 |
| `Type YOUR CHOICE; press ENTER` | After choosing an ITEM with a YOUR CHOICE column | value, ENTER | ORG p.66; TB2 p.135 |
| `Type ID letter to choose Field. Press ENTER:` | Field lists (Reportpack) | | ORG p.131 |
| `Type ID letter to cancel print job; press ENTER:` | DISPLAY PRINT QUEUE OR CANCEL PRINT JOB | ID to cancel, or ENTER | ORG p.134 |
| `Press ↓ key or ↑ key to see more.  When finished, press ENTER.` | Display Index | cursor keys scroll, ENTER | ORG p.132 |
| `Type document name; press ENTER` | Create/Revise/Paginate/Print/Check document; name pre-filled with the last document used | ENTER to accept or BKSP/CANCL then type; optional CODE+M separator + diskette name | TB1 p.8, TB2 p.79; ORG p.507, p.519 |
| `Type diskette name; press ENTER` (also printed `Type Diskette Name; press ENTER`) | Dual unit with two work diskettes, or diskette not identifiable | diskette name, ENTER | TB2 p.101; ORG p.322 |
| `Type Abbreviation; Press ENTER.` | MENU BYPASS | abbreviation (+ args), ENTER | ORG p.445 |
| `Delete what?` | DEL | extend highlight, ENTER | ORG p.352 |
| `Move what?` | MOVE | extend, ENTER (or COLUMN) | ORG p.477 |
| `Copy what?` | COPY | extend, ENTER (or COLUMN) | ORG p.339 |
| `To where?` | MOVE/COPY after ENTER | move cursor, ENTER | ORG p.339, p.477 |
| `Overstrike what?` | OVERSTRIKE | extend, ENTER | ORG p.484 |
| `Overstrike with what character?` | OVERSTRIKE after ENTER | one character, ENTER | ORG p.484 |
| `Find what?` | FIND | characters, ENTER (ENTER alone repeats last) | ORG p.488 |
| `Type page number; press ENTER` | GO TO (also MOVE/COPY to another page via GO TO) | number, ENTER; ENTER alone = next page | TB2 p.112, p.124 |
| `Hyphenate where?` | LINE ADJ / prompted hyphenation reaches a word crossing the margin | see 4.19 | TB2 p.579 |
| `Press ENTER to replace or delete, or press CANCL.` | GLOBAL prompted match | ENTER / CANCL then ENTER | ORG p.390 |
| `Press ENTER to continue search.` | After a prompted replacement | ENTER | ORG p.391 |
| `Type new keyboard number; press ENTER` | KYB CHG | keyboard number, ENTER | TB2 p.548 |
| `Type variable name; press ENTER` | VARIABL, conditional text | 1-16 chars, ENTER | ORG p.449, p.455 |
| `Skip to what line number?` | INSTR Skip to Line | number, ENTER | ORG p.408 |
| `Retype word; Press ENTER.` | Prompted spell check (under `Check spelling of word:` and the word) | retype + ENTER; ENTER alone removes highlight; SPELL leaves highlight | ORG p.110 |
| `Press ENTER to continue or press CANCL.` | Create Document Of Supplemental Words and other confirmations | | ORG p.345 |
| `Insert diskette to be erased or initialized in diskette slot:` / `Press ENTER.` | ERASE OR INITIALIZE (single unit) | insert, ENTER | ORG p.143 |
| `Insert diskette to be recovered into diskette slot; press ENTER:` | RECOVER DOCUMENTS (single) | insert, ENTER | ORG p.218 |
| `Type number for spacing between tabs; press ENTER.` | MARGINS AND TABS, set all tabs (also on the menu) | digits, ENTER | ORG p.177, p.183 |
| `Type name of 2D diskette to receive programs; press ENTER` | Combined program diskette | | ORG p.320 |
| `Contents of receiving diskette will be deleted. Press ...` (truncated) | Combined program diskette | | ORG p.320 [UNCLEAR] |
| `Contents of 'To Diskette' will be deleted.` | Duplicate Program Diskette | | TB2 p.523 |
| `Insert desired program or feature diskette ...` (truncated) | Program diskette tasks | | TB2 p.522 [UNCLEAR] |
| `Press ENTER to revise column. Press COLUMN to create ...` (truncated) | COLUMN key | | ORG p.315 [UNCLEAR] |
| `Move cursor to last line of table, press ENTER.` | Column layout of existing table | | ORG p.317 |

### 6.2 Messages (message line or status)

| Wording | When | Operator action | Source |
|---|---|---|---|
| `Loading Program` (status line 1) | IPL after inserting the program diskette | wait | ORG p.59 |
| `*15*` or `*11*` with the large IBM initials (any other number = power-on test failure) | Power-on test passed, no program diskette | insert Vol. 01 program diskette | ORG p.58 |
| `Paginating Document` (status line 1) | During pagination | wait / END cancels | TB2 p.62 |
| `(abbreviation) not allowed at this time.` | Menu bypass not valid here | | ORG p.446 |
| `Global Replace/Delete completed. (number) phrases changed.` | Prompted global ends | | ORG p.391 |
| `Global Replace/Delete completed. (number) phrases found.` | Automatic global ends | | ORG p.392 |
| `No phrases found. Global Replace/Delete completed.` | No match | | ORG p.393 |
| `Recover documents complete.` | Recover task finished (each recovered document name shown first; ENTER after each) | review documents | ORG p.498 |
| `Error on Diskette (diskette name)` | Recover failed | see Prompts and Messages guide | ORG p.497 |
| `Supplement loaded. (number) words now in supplement.` | Load Supplement | | ORG p.425 |
| `Supplement Cleared.` | Clear Supplement | | ORG p.305 |
| `Supplement stored.` | Store supplement | | ORG p.527 |
| `Supplement words written to (document name)` (queued) | Create Document Of Supplemental Words | | ORG p.345 |
| `Cursor not on decimal point or number.` | Math key with cursor elsewhere | | TB2 p.248 |
| `Total = (number) Item Count = (number)` (prompt line) | Math | | ORG p.432 |
| `Put on printer element (xxx yyy)` (typestyle and keyboard number) | Print needs another element/printwheel | change it, or REQST e to continue | TB2 p.553 |
| `# This document is printing now.` (legend in print queue) | Print queue display | | ORG p.134 |
| `Headers exist. Type alternating header or press CANCL to keep existing one.` | Alternating headers when headers exist | | TB2 p.460 |
| `XXXXX is not work diskette.` (XXXXX = diskette name) | Program diskette inserted where a work diskette is needed | insert a work diskette | TB2 p.664; ORG p.251 |
| `(Document) already exists.` | Create Document (or rename) with a name already on the diskette | choose another name | TB2 p.648; TB1 p.8 |
| Key save reminder (wording not given) | KEY SAVE started | press KEY SAVE to stop | ORG p.411 |
| Document deleted / name changed / diskette name changed / duplicated / condensed / erased-initialized / paginated / printed / converted (wordings not given) | Completion of those tasks | | ORG p.272, p.275, p.332, p.350, p.364-365, p.377, p.491, p.493 |
| `Conversion complete` | Convert document to file | | ORG p.337 |
| `Duplication complete` | Duplicate selected records | | ORG p.370 |
| `Combine Task completed. Receiving diskette renamed to ...` | Combined program diskette | | ORG p.321 |
| `Machine setup duplicated.` | Duplicate Machine Setup | | TB2 p.646 |

Print-queue full, printer and diskette error messages: ORG says a message appears (ORG p.213) but gives
no text **[NOT IN ORG]**.

---

## 7. Format parameters, limits and defaults

### 7.1 LINE FORMAT menu (ORG p.179-180, p.282-284)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Line Spacing | 1 | 1 Single, 2 Double, 3 Triple, 4 Half, 5 1 and 1/2 |
| b | Line Alignment | 1 | 1 Left, 2 Justify, 3 1/2 Justify |
| c | Typestyle Number | 86 | 1-31 (10 pitch), 80-111 (12 pitch), 154-175 (PSM), 215-230 (15 pitch) |
| d | Lines/cm or in. | 2 | 1 = 2.09/cm or 5.3/in; 2 = 2.36/cm or 6/in; 3 = 3.15/cm or 8/in; 4 = 9.45/cm or 24/in; 5 = 2.0/cm or 5.08/in |
| e | Adjust Line Endings | 1 | 1 Yes, 2 No |
| f | Zone Width | 6 | 1-30 |

Typestyle determines pitch; default 86 is a 12-pitch style (Pitch 12 on the status line). On the 5218
printwheel printer, line densities 1-4 are supported, 5 with a special platen. The first line always starts
1 inch from the top (ORG p.180).

### 7.2 MARGINS AND TABS (ORG p.183-184, p.426-429, p.529-536)
No ID letters; edited directly on the scale line:
- Cursor Left/Right moves the scale cursor. On `«` or `»`, Space moves that margin right, BKSP left.
- At a position: TAB = left tab, `.` = decimal, `,` = comma, CTR = centre, RET = right (flush right),
  `:` = colon.
- DEL on a tab clears it; DEL on `«` clears all tabs.
- On a tab, Space/BKSP shifts that tab *and all tabs to its right* right/left.
- On `«`, typing a 1-2 digit number (not echoed) then ENTER clears all tabs and sets a grid every n
  positions between the margins.
- ENTER when finished.
- Up to 48 tabs; up to 15 indent levels.
- Defaults: left margin 18, right margin 90 (WSPG p.20, p.26, p.36; consistent with the scale line in ORG
  p.29). Default tabs: a default tab grid exists (TB2 p.411) but its spacing is **[NOT IN ORG]**.
- Maximum line length / highest scale position **[NOT IN ORG]**; TB2 p.479 shows a right margin of 120, so
  lines wider than 80 columns (segmented display) are normal.

### 7.3 PAGE FORMAT (ORG p.208-209, p.291-292)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | First Typing Line, First Page | 7 | 1-999 |
| b | First Typing Line, Following Pages | 7 | 1-999 |
| c | Last Typing Line | 60 | 2-999 |
| d | Paper or Envelope Size | 3 (8.5 x 11 in) | 1 A4 210x297, 2 A4L, 3 P4 8.5x11, 4 P4L, 5 Legal 8.5x14, 6 Legal L, 7 Env 9.5x4.13, 8 C5 Env 229x162, 9 Other in mm (1-999.9, one decimal) |
| e | Printing Paper Source | 1 | 1 Top, 2 Bottom, 3 Bottom This Page Only, 4 Manual Feed |

First line > last line (or vice versa) gives an "invalid" prompt (wording not given). Page format changes
only at the first position of a page.

### 7.4 HEADER AND FOOTER (ORG p.165-166, p.267, p.280)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Create or Revise Header | | blank screen or current header |
| b | First Header Line | 3 | 1-999 |
| c | Print Header On | 1 | 1 All Pages, 2 All But First Page |
| d | Create or Revise Footer | | |
| e | First Footer Line | 63 | 2-999 |
| f | Print Footer On | 1 | 1 All Pages, 2 All But First Page |

Header/footer text uses the current format but always single spacing with Auto CR off; typestyle and
margins cannot vary per page. Alternating header/footer text max 256 characters each; no format changes;
Auto CR and LINE ADJ inactive (ORG p.267).

### 7.5 PAGINATE DOCUMENT (ORG p.210-211, p.490-491)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Paginate From Page | 1 | 1 - (pages in document) |
| b | Paginate on Exact Line Count | 2 | 1 Yes, 2 No |
| c | Adjust Line Endings | 1 | 1 Yes, 2 No |
| d | Adjust Page Endings | 1 | 1 Yes, 2 No |

Behaviour: from the chosen page to the end of the document; re-flows lines between margins (if c), moves
temporary page ends to fit First..Last Typing Line (if d), respects Required Page Ends and Keeps, and
renumbers system pages to whole numbers. Exact Line Count = Yes ends pages exactly at the Last Typing Line
(widows possible); No keeps widow lines with their paragraph by ending a page one line before or after the
Last Typing Line. Renumber only: c = No, d = No. Not available if Preserve Page Numbers = Yes. Runs
unattended (unless hyphenation is prompted, via Spelling Tasks) and returns to TYPING TASKS with a
completion message. END cancels.

### 7.6 PRINT DOCUMENT (ORG p.212-213, p.492-493)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Print From Page | 0 | 0 = First Page, or a system page number up to 9999.9.9 |
| b | Print Through Page | 0 | 0 = Last Page, or a system page number |
| c | Print Quantity | 1 | 1-99 (collated) |
| d | Paper Handling | 2 | 1 Cut Paper Manual Feed, 2 Cut Paper Automatic Feed, 3 Continuous Paper |
| e | Cancel on Error | 2 | 1 Yes, 2 No |

ENTER without changes prints one copy of the whole document. Queue capacity 6 documents (ORG p.134, p.213,
p.492). The document's diskette must be loaded when the job reaches the head of the queue; the system
prompts for it. Printing runs from the queue while the operator goes on working; on a dual unit it can print from one diskette while tasks run on the other (ORG p.54, p.494). Printing cannot run
during Change Diskette Name or Condense (ORG p.98, p.118).

### 7.7 CREATE OR REVISE DOCUMENT (ORG p.128-129)
a Document Comment (max 44); b Change Document Format; c Change Alternate Format; d Preserve Page Numbers
(default 2 = No). ENTER goes to the typing area.

### 7.8 WORK STATION DESCRIPTION (ORG p.246-248)

| ID | Item | Default | Choices |
|---|---|---|---|
| a | Auto Carrier Return/Auto Adjust | 1 | 1 On, 2 Off |
| b | Required Carrier Return | 2 | 1 Coded, 2 Non-Coded |
| c | Required Hyphen | 2 | 1 Coded, 2 Non-Coded |
| d | Engraved Keyboard | 1 | 1 Before First Alternate, 2 After Fifth Alternate |
| e-i | Alternate Keyboards First..Fifth | none | 1-313 |
| j | Alternate Task | 2 | 1 Yes, 2 No |
| k | Tone in Alternate Task | 1 | 1 Yes, 2 No |
| l | Final-form Document Support | 1 | 1 Yes, 2 No |

Changing it causes an automatic re-IPL on returning to TASK SELECTION (ORG p.246, p.297). Same for
Printer Description, Check Document Defaults and Paginate Document Defaults changes (ORG p.272, p.293-294).

### 7.9 Other menus touching the editor
- **CHECK DOCUMENT** (ORG p.108): a Kind Of Spelling Check (1 Prompted default, 2 Automatic, 3 None);
  b System Page Number(s) For Spelling Check (up to 10); c Hyphenation/Pagination (1 Yes default).
- **HYPHENATE AND PAGINATE DOCUMENT** (ORG p.167): a Dictionary Hyphenation (1 Prompted, 2 Automatic,
  3 None); b Paginate, Hyphenate, Spell Check from Page (1); c Paginate On Exact Line Count (2);
  d Print Paginated Pages (1 Yes); e Paper Handling (1).
- **SCREEN FORMAT** (ORG p.226): Display Codes, default 2 No.

### 7.10 Limits

| Limit | Value | Source |
|---|---|---|
| Document name | 1-44 characters; up to 20 shown on the status line; 44 in the printed index | ORG p.345, p.363 |
| Document comment | up to 44 characters | ORG p.128, p.362 |
| Diskette name | up to 6 letters and/or digits; required before use | ORG p.272, p.376-377 |
| Documents per diskette | **[NOT IN ORG]** (index shows "Displaying: 1 to 4 of 4") | ORG p.132 |
| Diskette capacity | Diskette 1: 284,160 bytes; Diskette 2D: 985,088 bytes of customer-usable characters and controls | MD p.1 |
| Pages per document | **[NOT IN ORG]**; system page numbers up to 9999.9.9 | ORG p.490 |
| Characters per page / line length | **[NOT IN ORG]** | |
| System page number format | whole numbers; pages inserted in revision get decimals (1.1, then a second level), max 9999.9.9; Paginate renumbers to whole numbers | ORG p.489-490 |
| Display | 20 text lines x 80 characters (25-line display) | ORG p.28 |
| FIND / GLOBAL argument | up to 60 characters; GLOBAL 3 pairs | ORG p.380, p.389-390 |
| GET / Include page list | Include up to 10 pages | ORG p.404 |
| Tabs | 48 | ORG p.531 |
| Indent levels | 15 | ORG p.536 |
| Zone width | 1-30 | ORG p.554 |
| Keystroke save | 250 keystrokes | ORG p.411 |
| Print queue | 6 documents; PRINT key 25 pages | ORG p.213, p.494 |
| Print quantity | 1-99 | ORG p.212 |
| Spell check selected pages | 10 | ORG p.517 |
| Supplement dictionary | 4500 characters (program diskette); 500 words per language supplement | ORG p.425, p.521 |
| Alternating header/footer | 256 characters each | ORG p.267 |
| Keyboards | home + 5 alternates (IDs 1-313) | ORG p.246 |
| Variable names | 1-16 characters | ORG p.464 |
| Menu-bypass short forms | 6 characters | ORG p.190 |
| Math precision | 15 digits | ORG p.445 |

---

## 8. Task structure (menus) relevant to the editor

```
IPL -> TASK SELECTION
  a Typing Tasks -> TYPING TASKS
       a Create Document   -> prompt name [,diskette] -> CREATE OR REVISE DOCUMENT -> ENTER -> typing area
       b Revise Document   -> (same)
       c Paginate Document -> prompt name -> PAGINATE DOCUMENT
       d Display Index of Diskette Contents
       e Print Document    -> prompt name -> PRINT DOCUMENT
       f Go to Task Selection
  b Work Diskette Tasks -> WORK DISKETTE TASKS
       a Delete Document  b Duplicate Document  c Change Document Name  d Change Diskette Name
       e Duplicate Diskette  f Condense Diskette  g Erase or Initialize (Name) Diskette
       h Recover Documents  i Print Index of Diskette Contents  j Display Final-form Document
       k Convert Final-form Document  l Go to Task Selection
  c Program Diskette Tasks (defaults, printer and work station description, ...)
  d Spelling Tasks -> SPELLING TASKS: a Check Document, b Load Supplement, c Clear Supplement,
       d Store Supplement On Program Diskette, e Choose Spelling Language Dictionary,
       f Create Document Of Supplemental Words, g Go To Task Selection
  e Feature Tasks   f Key-To-Print Task   g Merge Tasks
```
ORG p.233-234, p.240, p.244-245, p.229. Each top-level task loads its own program segment from the program
diskettes: Vol. 01 IPL and Program Diskette tasks; Vol. 02 Typing, Spelling, Key-To-Print; Vol. 03 Work
Diskette and Merge (ORG p.55). On a dual unit TP4note puts the program diskette in the left drive and the
work diskette in the right. With a single unit the operator swaps diskettes when prompted
**[INFERRED]**; the exact swap prompts are **[NOT IN ORG]**. END from the typing area returns to TYPING
TASKS (ORG p.67).

Re-IPL without power-off: on TASK SELECTION remove diskettes, CONTROL+RET, ENTER; IBM initials return in a
few seconds (ORG p.59, p.399).

---

## 9. Document storage model

- **Work diskettes** hold documents; they must be initialised and named (up to 6 alphanumerics) before
  use; the system makes you initialise/name an unnamed diskette when it is inserted (ORG p.55, p.376).
  An unformatted diskette shows `******` in the status line (TP4note). Program diskettes are pre-named,
  write-protected against Erase/Initialize, and cannot be renamed (ORG p.56, p.376).
- **Diskette label:** the physical label carries the operator's name for the diskette; write only in the
  label area with a fibre-tip pen (ORG p.62). Labels face left when inserted (ORG p.56-57).
- **Document identity:** name (1-44 chars, any typed characters including spaces, e.g. `Mtg Ltr A`) plus
  diskette name. Names must be unique per diskette; the same name may exist on another diskette
  (ORG p.137, p.365). Case sensitivity **[UNCLEAR]**.
- **Index (Display Index of Diskette Contents)** (ORG p.132-133): header `Diskette: DISK01  Available: 70%
  Unusable: 0%  Displaying: 1 to 4 of 4`; columns `DOCUMENT NAME`, `TYPE`, `COMMENT`; types `Document`,
  `File`, `File Setup`, `Sys. Doc.`, `Unknown` (and Final-form); `*` before a name marks a document needing
  recovery (legend `* indicates that document needs recovery.`); list ends `END OF INDEX OF DISKETTE
  CONTENTS`; scroll with cursor up/down; ENTER to leave. Unusable over 10%, or growing over 1% per job,
  means duplicate the diskette. Order of entries **[UNCLEAR]** (sample is not alphabetical: creation order
  likely). Not available during Program Diskette Tasks.
- **Printed index** (ORG p.494): `INDEX OF DISKETTE CONTENTS`, `DISKETTE: KLSAAA  Available: 26%  Unusable:
  0 %`, then for each document `DOCUMENT NAME:`, `TYPE:`, `COMMENT:`; fixed format; ignored if the printer
  is busy.
- **Document contents:** pages separated by Page End codes; a document format (line, margins/tabs, page,
  header/footer, alternate format) stored with the document; in-text format change codes; Preserve Page
  Numbers flag; comment. A new document takes the program diskette's Document Format defaults (ORG p.274,
  p.384).
- **Two stored setups** on the Vol. 01 program diskette: Document Format defaults and Alternate Format
  defaults (ORG p.362, p.384).
- **Saving:** pages are written as you work (PRINT stores the page, ORG p.495); END finishes the document.
  A document that did not end properly (power loss, diskette removed) is flagged `*` and must be recovered
  with Recover Documents, which may insert Substitute codes where data was lost (ORG p.497-498, p.527).
- **Operations:** Delete (removes name and comment from the index; not while printing it), Duplicate
  (same or other diskette; "Combining Documents" appends one document to another), Change Document Name
  (name and comment), Change Diskette Name, Duplicate Diskette (same media type only; erases the target),
  Condense Diskette (copies and compacts to another diskette; more tolerant of errors, slower), Erase or
  Initialize (Name), Recover (ORG p.130, p.137, p.272-275, p.330-332, p.350, p.364-365, p.374-377, p.497).

---

## 10. Timings

ORG gives almost none. All values below are what the sources state; everything else must be modelled
from the drive mechanism (plan, *Diskette unit*).

| Event | Value | Source |
|---|---|---|
| Re-IPL by CONTROL+RET, ENTER to IBM initials | "a few seconds" | ORG p.59, p.399 |
| Power on to IBM initials and `*11*` | `05` after a few s, `06` after ~1 s, `09` after a few s, then `* 11*` after a few s (total roughly 10 s) | TP4note |
| Program diskette inserted to TASK SELECTION | screen clears at once to `Loading program`, then about 10 s | TP4note |
| Prompted global search, CANCL | stops at next match or end of current page | ORG p.392 |
| Print paginated pages | first page must print before some other tasks can run | ORG p.495 |
| Typematic rate, cursor blink rate, message-arrow flash rate | not stated | [NOT IN ORG] |
| Save/page read times | not stated | [NOT IN ORG] |

Implied behaviour: pagination, spell check and global replace run as visible progress (page numbers
display as the document is checked, ORG p.301); diskette operations that cannot be ENDed (duplicate,
erase, condense, rename) are long enough to need that rule (ORG p.372-373).

---

## 11. Gaps and open questions

1. **Message catalogue.** Complete prompt/message list with numbers is in S544-2122 *Prompts and Messages
   Guide*, not available. Many completion and error messages are referenced without wording (section 6.2).
2. **Document/diskette limits:** maximum pages per document, characters per page, documents per diskette,
   maximum line length or right-margin position: not in ORG. Diskette byte capacity from MD only.
3. **Default tab stops** not given (only "default tab grid" exists, TB2 p.411). Default margins 18/90 come
   from WSPG.
4. **Status-line field positions** and the Insert/Replace indicator text are not specified; use the
   rendered samples (ORG p.110, TB2 p.135).
5. **Scale-line tab glyphs** are OCR-damaged (ORG p.184, p.533); render the pages to confirm.
6. **Code widths on screen** (which codes occupy a column with Display Codes = No) are not stated.
7. **Keyboard repeat:** only COLUMN ADD, ROW ADD and LINE ADJ are said to repeat. No rates.
8. **FIND not found** behaviour/message not described; GO TO past end is.
9. **Page-to-page cursor movement** with arrow keys across a Page End is not described.
10. **CODE+INDEX** = Index Return is inferred.
11. **Which GLOBAL mode reports "changed" vs "found"** conflicts between ORG p.392 and TB2 p.135.
12. **Single-diskette program/work swaps** (which prompts, when) not described in ORG.
13. **Card Rept (CODE+1)** appears in Appendix B only; behaviour not described.
14. Some OCR corrections in the menu-bypass table are inferred (l vs 1 vs I).
