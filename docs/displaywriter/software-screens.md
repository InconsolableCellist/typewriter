# Textpack 4 on screen: screens, menus and workflows

Research for `wordproc1980` (see `docs/displaywriter/plan.md`, "Software (editor)"). This is a behavioural
reimplementation, so everything here comes from the 1982 manuals. I have kept screen, prompt and message
wording exactly where it is short functional UI text. Everything else is summarised. Where a source is unclear
or two sources disagree, the item is marked **UNCLEAR** or **CONFLICT**.

## Sources and citation keys

| Key | Document | Notes |
|---|---|---|
| `WSPG p.N` | S544-2037-0 Work Station Procedures Guide, Textpack 4 (Feb 1982) | Procedures and work samples. It has almost no screen pictures. |
| `TB2 p.N` | S544-2035-0 Operator Training Book 2, Selectable Topics, Textpack 4 | Real screen figures (typed facsimiles) and step-by-step exercises |
| `TB1 p.N` | Displaywriter Operator Training Book 1, Basic Topics (46 pp) | A retyped transcription with no figures. See the caveat below. |
| `TP4 p.N` | "IBM Displaywriter and TEXTPACK4" (4 pp) | Modern hobbyist notes: power-on timings and keystroke recipes |
| `ORG p.N` | S544-2036-0 Operator Reference Guide (with 1982–83 TNL pages) | Not on the assigned list, but its Section 2 "Menus" (ORG pp.64–247) has one screen facsimile per menu, so I used it for the menu tree and the display format. The function-by-function content is left to the other researcher. |

`p.N` is always the **PDF page** (1-based), not the printed folio.

**Caveat on TB1.** The transcription talks about *two* program diskettes ("Vol. 1" and "Vol. 2", TB1 p.4, p.7)
and about a 30-second load (TB1 p.6). Textpack 4 has *three* (Vol. 01 for IPL and program-diskette tasks;
Vol. 02 for Typing, Spelling and Key-To-Print; Vol. 03 for Work Diskette and Merge tasks, ORG p.55). In
TB1 p.12 "d" is also the ID for Print Document, but the Textpack 4 TYPING TASKS menu has Print as "e"
(ORG p.240). TB1 is good for the *flow* and the *wording of prompts*. Its item letters and its diskette juggling
may come from an earlier Textpack. **CONFLICT** wherever they differ from ORG/TB2.

### Best screen illustrations (PDF pages)

* Display format and the five screen areas: ORG p.29 (whole screen, status lines, scale line), ORG p.30 (status line 2 fields
  G–L), ORG p.31 (scale line symbols: margins, tab kinds, center point, scale cursor), ORG p.32 (segmenting and scrolling diagrams)
* IPL screen (IBM initials and `*15*`): ORG p.59
* Status line with typing fields (Pg., Ln., Kyb, Pitch): TB2 p.135 (GLOBAL menu over a document). Status line 1 with
  a function and a symbol name: ORG p.558
* Menus (typed facsimiles, best quality first): TB2 p.156 (PRINT DOCUMENT, evenly spaced, so the rows can be read off directly), ORG p.233
  (TASK SELECTION), ORG p.240 (TYPING TASKS), ORG p.244 (WORK DISKETTE TASKS), ORG p.238 (TEXTPACK REQUEST TASKS),
  ORG p.128 (CREATE OR REVISE DOCUMENT), ORG p.210 (PAGINATE DOCUMENT), ORG p.229 (SPELLING TASKS), ORG p.108 (CHECK
  DOCUMENT), ORG p.167 (HYPHENATE AND PAGINATE DOCUMENT), ORG p.110 (CHECK SPELLING OF WORD, with document text), ORG p.132
  (DISKETTE CONTENTS index), ORG p.137 (DUPLICATE DOCUMENT), ORG p.144 (ERASE OR INITIALIZE, dual), ORG p.156 (FORMAT
  SELECTION), ORG p.179 (LINE FORMAT), ORG p.183 (MARGINS AND TABS with a live scale line), ORG p.208 / TB2 p.54 (PAGE FORMAT),
  ORG p.134 / TB2 p.158 (print queue), TB2 p.159 (CHANGE PRINTING ORDER), ORG p.611 / TB2 p.611 (TEXTPACK PROGRAM DISKETTE TASKS)
* Symbol glyphs shown in text: ORG pp.558–562 (Appendix B, "Function and Symbol Information")
* Menu-sequence diagrams (the tree): ORG pp.68–84

The facsimiles are typewriter mock-ups. Their columns are close to the real screen, but **several leave out blank rows
or are wider than 80 columns**: the Task Selection figure has 27 rows, and some frames are 81–82 cells wide. The grids
below are my reconstruction onto the documented 80 × 25 display. Column positions come from measuring the PDF text-layer
word boxes (`pdftotext -bbox`). Each one is accurate to about ±1 column.

---

## 0. The display model (applies to every screen)

* **25 rows × 80 columns** on the standard display: 2 status lines, 1 scale line, 20 typing/menu lines, 1 prompt
  line and 1 message line (ORG p.28, p.29). The tube is 12 in. diagonal and shows bright green characters on a dark background (TB1 p.4; ORG p.28).
  A large display with 61 lines × 100 characters existed. It is out of scope (ORG p.28).

| Row | Area | Content |
|---|---|---|
| 1 | Status line 1 | Current task or function (field A), document name (B), Ins/Repl (C), key save/playback (D), symbol under cursor (E), combined-diskette name (F) (ORG p.29–30) |
| 2 | Status line 2 | Left diskette (G), right diskette (H), system page `Pg. n` (I), line `Ln. n` (J), `Kyb n` (K), `Pitch nn` (L) (ORG p.30–31). The whole row is **underlined** (TP4 p.2; it shows as a dashed rule in every facsimile) |
| 3 | Scale line | Only while creating or revising text, in MARGINS AND TABS, and in headers/footers (ORG p.31). It is blank in other menus |
| 4–23 | Typing and menu area | 20 lines of text, or a menu (ORG p.28, p.32) |
| 24 | Prompt line | **Highlighted**. Tells the operator what to do next (ORG p.33) |
| 25 | Message line | Task status, printer needs and errors. A blinking arrow at bottom left means messages are waiting (TB1 p.13; ORG p.480) |

**Status-line field columns** (measured from ORG p.30, ORG p.558 and TB2 p.135, which agree to within 1 column; the separators
show as thin vertical bars, drawn here as `|`):

```text
row 1:  A = 1-20 | B = 22-41 | C = 43-46 | D = 48-51 | E = 53-71 | F = 73-80     (bars at 21,42,47,52,72)
row 2:  G = 1-6  | H = 8-13  | (15-34 blank) | I = 36-48 | J = 50-58 | K = 60-69 | L = 71-80   (bars at 7,14,35,49,59,70)
```

* TP4 p.2 confirms G = positions 1–6 and H = 8–13. An unformatted diskette shows as `******`.
* Program diskettes show their own names (`PRODSK`, `CMBDSK` for a combined one, ORG p.235, TB2 p.614).
* **UNCLEAR:** whether each bar takes up a character cell. The facsimiles draw them in cells, so the grids do too.
  Several 1982 menu facsimiles put `Kyb 1` around columns 50–56 rather than 60 (TB2 p.156, ORG p.233). These look
  like drawing variation. The labelled diagram on ORG p.30 is the authority.
* Example values: A shows `Loading Program` (ORG p.59), `Paginating Document` (TB2 p.62), `Spell Check` (ORG p.110),
  `Displaying Index` (ORG p.132), `Copy Text` (ORG p.558, ORG p.29), `Format Change` (ORG p.179, TB2 p.54),
  `Chg Document Fmt` (ORG p.93, p.156), `Chg Doc Fmt Defaults` (ORG p.92). E shows names such as `Word Und`, `Req'd Carrier Ret`, `Tab`,
  `Page End`, `Required Space` (ORG pp.558–562; TB2 p.113, p.116). E also shows the spelling language, e.g. `U.S. English` (ORG p.110).
* With Alternate Tasks on, a `1` or `2` appears at the right edge of status line 1. CODE+ENTER switches tasks.
  Messages from the hidden task show as `1=>` or `2=>` (ORG p.253).

**Menu conventions** (ORG p.64–66; TB1 p.29, p.41):

* The title is centred near the top (row 4 in the evenly spaced TB2 p.156 facsimile). The columns are `ID`, `ITEM`, and
  optionally `YOUR CHOICE` and `POSSIBLE CHOICES`.
* Prompt (row 24): `Type ID letter to choose ITEM; press ENTER:` followed by the cursor `_`. After an ID letter is
  ENTERed on an item with a YOUR CHOICE column, the prompt becomes `Type YOUR CHOICE; press ENTER` (TB1 p.29, p.31; ORG p.66).
* Row 22 holds `When finished with this menu, press ENTER.` when the menu has settable items (TB2 p.156; TB1 p.9).
* A changed YOUR CHOICE value is **highlighted** (TB1 p.29, p.33; ORG p.65). ENTER with an empty prompt
  accepts the whole menu. Invalid choices give an error message that stays until it is corrected or cancelled (ORG p.65).
* Shortcut: type the ID letter, a space and the value, then ENTER (`c 2`) (TB1 p.41; ORG p.66).
* In menus the cursor stays on the prompt line. Only typing and BKSP move it, and the arrow keys do nothing (ORG p.32).
* **CODE+CANCL** removes things one step at a time: (1) the answer typed at the prompt, (2) the prompt, (3) all the menu choices,
  (4) the menu itself, back to the previous one (ORG p.66; TB1 p.7). REQST is the same key without CODE (TB1 p.7, p.12).
  CANCL does not leave the typing area. Only END does (TB1 p.11).
* Document-name and diskette-name prompts: `Type document name; press ENTER.` then `Type diskette name; press ENTER.`
  (TB1 p.8; TB2 p.68). The last-used names are **suggested** (pre-filled) on the prompt line. Use BKSP or CODE+CANCL to
  clear them (TB1 p.12–13, p.16). If the named diskette is not inserted, a prompt asks for it by name. CODE+REPLY
  answers a wrong diskette request so the names can be typed again (TB1 p.9, p.13).
* Menu Bypass: CODE+MENU BYPASS (on the GO TO key) gives `Type abbreviation; press ENTER.`. Then type e.g.
  `c First Letter`, then CODE+m (the separator between document and diskette), then `TRAIN`, then ENTER. This goes straight to the typing area
  with the default format (TB1 p.42). The keyword and short-form table is on ORG p.85–86 (e.g. create/c, revise/r, print/p,
  paginate/pg, index/i, global/gl, martab/mt, pgfmt/pf, codeyes/cdy).

---

## 1. Power-on and start-up (IPL)

**Operator actions and screens, in order:**

1. Turn the **printer** on first (ORG p.58). In a shared-printer setup the primary work station must be powered and IPLed
   before any station can print (ORG p.59; WSPG p.60).
2. Turn the system on with the switch on the Electronics Module, with the diskettes **out** (TP4 p.1; TB1 p.4; ORG p.58).
3. A Basic Assurance Test runs. TP4 p.1 gives the visible sequence:
   * after "a few seconds", `05` appears at about **row 20, column 10**;
   * about 1 s later it becomes `06`;
   * a few seconds later it becomes `09`;
   * a few seconds later `* 11*` (shown `*11*` / `*15*` in ORG) replaces it **and large "IBM" initials appear**.
   ORG p.58: the IBM initials and `*15*` or `*11*` appear on a successful test. Any other number on the
   message line at bottom left is an error code (e.g. `*801* 01 01` means the keyboard is not connected, TP4 p.1). The ORG p.59 drawing
   puts `*15*` at bottom left and the large IBM logo at bottom right of the tube. TB1 p.4 says "After several
   seconds, the letters IBM should appear". The operator may adjust the brightness and contrast knobs at this point.
4. Insert the Vol. 01 Program Diskette, or a combined diskette, label facing left, and close the load lever by turning it right
   (ORG p.56–57, p.59). Either slot of a dual unit will IPL (ORG p.59). TP4 p.1 puts it in the **left** drive.
5. The screen clears at once and `Loading Program` appears on status line 1 (TP4 p.1; ORG p.59).
6. After about **10 s** of diskette activity the TASK SELECTION menu appears (TP4 p.1). TB1 p.6 says "a clicking sound
   for about 30 seconds" (older two-diskette program, so it is an upper bound). If the program diskette was already
   inserted at power-on, the IBM initials are skipped (ORG p.68).
7. Choosing a task family loads its program from the matching volume. The system prompts to insert Vol. 02 or Vol. 03
   (TB1 p.7; ORG p.55). On the way back the TASK SELECTION menu flashes up briefly with the new task highlighted,
   and the next program "loads" (TB2 p.68, p.74). The exact prompt wording for a program-volume swap is
   **UNCLEAR**. The nearest attested wording is `Insert desired program or feature diskette; press ENTER` (TB2 p.610,
   p.646, for program-diskette tasks).

To IPL again without powering off: go to TASK SELECTION, remove the diskettes, type a Zero Index Carrier Return (CONTROL+RET),
then press ENTER. The IBM initials return "in a few seconds" (ORG p.59).

When the PRINTER or WORK STATION DESCRIPTION menus are changed, the system re-IPLs by itself on returning to
TASK SELECTION (ORG p.235, p.246).

**IPL screen (reconstruction; row 20 col 10 from TP4, the logo position from the ORG p.59 drawing):**
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                                                                                   
 2 _                                                                                 
 3                                                                                   
 4                                                                                   
 5                                                                                   
 6                                                                                   
 7                                                                                   
 8                                                                                   
 9                                                                                   
10                                                                                   
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20            *11*                                              I B M  (large)       
21                                                                                   
22                                                                                   
23                                                                                   
24                                                                                   
25                                                                                   
```

**While loading:**
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Loading Program     |                                                           
 2 _                                                                                 
 3                                                                                   
 4                                                                                   
 5                                                                                   
 6                                                                                   
 7                                                                                   
 8                                                                                   
 9                                                                                   
10                                                                                   
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24                                                                                   
25                                                                                   
```

---

## 2. The menu tree

```text
IPL ─► TASK SELECTION (ORG p.233)
 ├─ a Typing Tasks ─► TYPING TASKS (ORG p.240)            [needs Vol. 02]
 │    ├─ a Create Document ─┐ prompts: document name, diskette name
 │    ├─ b Revise Document ─┴► CREATE OR REVISE DOCUMENT (ORG p.128) ─ ENTER ─► typing area
 │    │        ├─ a Document Comment (≤44 chars)
 │    │        ├─ b Change Document Format ─► FORMAT SELECTION (ORG p.156)
 │    │        │        ├─ a Change Line Format ─► LINE FORMAT (ORG p.179)
 │    │        │        ├─ b Change Margins and Tabs ─► MARGINS AND TABS (ORG p.183)
 │    │        │        ├─ c Change Page Format ─► PAGE FORMAT (ORG p.208)
 │    │        │        ├─ d Change Header and Footer ─► HEADER AND FOOTER (ORG p.164)
 │    │        │        └─ e Change Alternating Headers and Footers (ORG p.93)
 │    │        ├─ c Change Alternate Format ─► FORMAT SELECTION (same)
 │    │        └─ d Preserve Page Numbers
 │    ├─ c Paginate Document ─► PAGINATE DOCUMENT (ORG p.210)
 │    ├─ d Display Index of Diskette Contents ─► DISKETTE CONTENTS (ORG p.132)
 │    ├─ e Print Document ─► PRINT DOCUMENT (ORG p.212)
 │    └─ f Go to Task Selection
 ├─ b Work Diskette Tasks ─► WORK DISKETTE TASKS (ORG p.244)   [needs Vol. 03]
 │    a Delete Document (ORG p.130)      b Duplicate Document (ORG p.137)
 │    c Change Document Name (ORG p.100) d Change Diskette Name (ORG p.98/99)
 │    e Duplicate Diskette (ORG p.135)   f Condense Diskette (ORG p.118)
 │    g Erase or Initialize (Name) Diskette (ORG p.143/144)
 │    h Recover Documents (ORG p.218/219) i Print Index of Diskette Contents
 │    j Display Final-form Document      k Convert Final-form Document (ORG p.124)
 │    l Go to Task Selection
 ├─ c Program Diskette Tasks ─► TEXTPACK PROGRAM DISKETTE TASKS (ORG p.235; TB2 p.611)
 │    a Change Document Format Defaults  b Change Alternate Format Defaults
 │    c Change Printer Description       d Change Work Station Description (ORG p.246)
 │    e Duplicate Machine Setup          f Duplicate Program Diskette (ORG p.139)
 │    g Erase Program Diskette           h Duplicate Spelling Supplement
 │    i Change Math Format Defaults      j Change Paginate Document Defaults
 │    k Change Check Document Defaults (TB2 p.76)  l Create New Combined Program Diskette
 │    m Update Combined Program Diskette n Change Menu Abbreviations   o Go to Task Selection
 │    (with a combined diskette, a PROGRAM DISKETTE TASKS menu comes first: TB2 p.617)
 ├─ d Spelling Tasks ─► SPELLING TASKS (ORG p.229)
 │    a Check Document ─► CHECK DOCUMENT (ORG p.108) ─► HYPHENATE AND PAGINATE DOCUMENT (ORG p.167)
 │    b Load Supplement  c Clear Supplement  d Store Supplement On Program Diskette
 │    e Choose Spelling Language Dictionary  f Create Document Of Supplemental Words  g Go To Task Selection
 ├─ e Feature Tasks (prompts for a feature diskette; FEATURE TASKS menu on a combined diskette, TB2 p.618)
 ├─ f Key-To-Print Task ─► FORMAT SELECTION FOR KEY-TO-PRINT (ORG p.160)
 └─ g Merge Tasks ─► MERGE TASKS (ORG p.198)

Keys that open menus from anywhere (they return to where you were on ENTER, ORG p.67):
 REQST     ─► TEXTPACK REQUEST TASKS (ORG p.238) (not during Program Diskette Tasks)
 CHG FMT   ─► FORMAT SELECTION (items depend on the cursor: page start, line start, mid-line; ORG p.70, p.157–159)
 INSTR     ─► INSTRUCTIONS (ORG p.174)
 CODE+SCREEN FORMAT ─► SCREEN FORMAT (ORG p.226)
 GET       ─► GET (ORG p.162)        GLOBAL ─► GLOBAL REPLACE/DELETE (TB2 p.135)
 SPELL (in the typing area) ─► ends the document, goes to Spelling Tasks ─► CHECK DOCUMENT (TB2 p.68)
```

The scope rule for implementation: the Textpack core is Typing, Work Diskette, Spelling and Request. Program
Diskette, Merge, Feature and Key-To-Print can be stubbed as menus whose items show a "not available" message.

### 2.1 TASK SELECTION (ORG p.233; appears after IPL)

There are 19 item lines. The ORG facsimile also has blank rows around `ID ITEM`, which cannot all fit in 20 lines.
Here they are packed into rows 3–23 (**UNCLEAR** whether the real title sits on row 3 or row 4).
In the ORG facsimile the diskette field G is empty and only `Kyb 1` shows.
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _       |      |                    |             |         |Kyb 1     |          
 3                          TASK SELECTION                                           
 4                ID   ITEM                                                          
 5                a    Typing Tasks:                                                 
 6                      Create, Revise or Paginate Documents                         
 7                b    Work Diskette Tasks:                                          
 8                      Delete or Duplicate Documents,                               
 9                      Duplicate, Condense or                                       
10                      Erase/Initialize(Name) Diskette,                             
11                      Print Index of Diskette Contents, Change                     
12                      Document or Diskette Name, Recover Documents,                
13                      Display or Convert Final-form Documents                      
14                c    Program Diskette Tasks:                                       
15                      Default Formats, Duplicate Setups,                           
16                      Printer and Work Station Description,                        
17                      Duplicate and Erase Program Diskette,                        
18                      Feature Program Diskette Tasks,                              
19                      Create and Update Combined Program Diskette                  
20                d    Spelling Tasks                                                
21                e    Feature Tasks                                                 
22                f    Key-To-Print Task                                             
23                g    Merge Tasks                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

Keys: type the letter (lower case as printed, upper case also accepted per TP4's recipes), then ENTER. BKSP corrects. There
is nothing to cancel back to.

### 2.2 TYPING TASKS (ORG p.240)
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                          TYPING TASKS                                             
 5                                                                                   
 6                     ID    ITEM                                                    
 7                                                                                   
 8                     a     Create Document                                         
 9                     b     Revise Document                                         
10                     c     Paginate Document                                       
11                     d     Display Index of Diskette Contents                      
12                     e     Print Document                                          
13                     f     Go to Task Selection                                    
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```
After a document is ENDed or paginated, the system comes back here with the next logical item **highlighted**,
e.g. `Revise Document` after spelling (TB2 p.72, p.74). ENTER on an empty prompt then picks the highlighted item
(**UNCLEAR**, inferred from "with Revise Document highlighted").

### 2.3 CREATE OR REVISE DOCUMENT (ORG p.128)

It appears after the name and diskette prompts. Status line 1 field B shows the document name. For a plain create the
operator just presses ENTER (TB1 p.9).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |Letter              |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                        CREATE OR REVISE DOCUMENT                                  
 5                                                                                   
 6                                      YOUR      POSSIBLE                           
 7     ID  ITEM                         CHOICE    CHOICES                            
 8                                                                                   
 9     a   Document Comment                                                          
10                                                                                   
11     b   Change Document Format                                                    
12                                                                                   
13     c   Change Alternate Format                                                   
14                                                                                   
15     d   Preserve Page Numbers        2         1 = Yes    2 = No                  
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

### 2.4 FORMAT SELECTION (ORG p.156) and its sub-menus

From CREATE OR REVISE (b or c), status line 1 reads `Chg Document Fmt`. From CHG FMT at the start of a page it
also lists f–j: `Return All Formats to Starting Choice`, `Return Line Format, Margins and Tabs to Starting Choice`,
`Return Typestyle to Starting Choice`, `Begin Using Document Format`, `Begin Using Alternate Format` (ORG p.157).
From CHG FMT it reads `Format Change` (ORG p.157, p.179).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Chg Document Fmt    |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                             FORMAT SELECTION                                      
 5                                                                                   
 6                      ID    ITEM                                                   
 7                                                                                   
 8                      a     Change Line Format                                     
 9                      b     Change Margins and Tabs                                
10                      c     Change Page Format                                     
11                      d     Change Header and Footer                               
12                      e     Change Alternating Headers and Footers                 
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

LINE FORMAT (ORG p.179). The default typestyle 86 (12 pitch) is the reason for `Pitch 12`.
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Format Change       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                                LINE FORMAT                                        
 5                                                                                   
 6                             YOUR       POSSIBLE                                   
 7     ID  ITEM                CHOICE     CHOICES                                    
 8                                                                                   
 9     a   Line Spacing        1          1 = Single  2 = Double  3 = Triple         
10                                        4 = Half    5 = 1 and 1/2                  
11     b   Line Alignment      1          1 = Left    2 = Justify                    
12                                        3 = 1/2 Justify                            
13     c   Typestyle Number    86         1 - 31 (10 pitch)                          
14                                        80 - 111 (12 Pitch)                        
15                                        154 - 175 (Proportional)                   
16                                        215 - 230 (15 Pitch)                       
17     d   Lines/cm or in.     2          1 = 2.09/cm or 5.3/in.                     
18                                        2 = 2.36/cm or 6/in.   3 = 3.15/cm or 8/in.
19                                        4 = 9.45/cm or 24/in.  5 = 2.0/cm or 5.08/i
20     e   Adjust Line Endings 1          1 = Yes     2 = No                         
21     f   Zone Width          6          1 - 30                                     
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

MARGINS AND TABS (ORG p.183). This menu has no ID letters. The cursor sits on the scale line under the left
margin `«`, which is highlighted. SPACE/BKSP move the margin, ←/→ move the cursor, and the scale line scrolls as you go
(TB1 p.34; ORG p.183). For tab keys: TAB = flush left, CTR = center, `.` = decimal, RET = flush right, `,` = comma; DEL clears.
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Format Change       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3   .«.2....:....3....:....4....:....5...▼:....6....:....7....:....8....:....»....:.
 4                                MARGINS AND TABS                                   
 5                                                                                   
 6      SET MARGIN: Use <- or -> key to move cursor to margin (<< or >>).            
 7                   Use SPACE bar or BKSP key to move margin.                       
 8                                                                                   
 9         SET TAB: Use <- or -> key to move cursor to where you want tab.           
10                  For Flush Left Tab, Press TAB  For Center Tab, press CTR         
11                  For Decimal Tab, press .  For Flush Right Tab, press RET         
12                  For Comma Tab, press ,                                           
13                                                                                   
14       CLEAR TAB: Use <- or -> key to move cursor to tab; press DEL.               
15                                                                                   
16       MOVE TABS: Use <- or -> key to move cursor to tab.                          
17                  Use SPACE bar or BKSP key to move tabs.                          
18                                                                                   
19    SET ALL TABS: Use <- or -> key to move cursor to left margin (<<).             
20                  Type number for spacing between tabs; press ENTER.               
21   CLEAR ALL TABS: Use <- or -> key to move cursor to left margin (<<);            
22                   press DEL.                                                      
23                                                                                   
24   When finished, press ENTER.                                                     
25                                                                                   
```

PAGE FORMAT (ORG p.208; TB2 p.54) items, with defaults:
`a First Typing Line, First Page 7 (1 - 999)`, `b First Typing Line Following Pages 7 (1 - 999)`,
`c Last Typing Line 60 (2- 999)`, `d Paper or Envelope Size 3` (1 A4, 2 A4L, 3 P4 8.5x11, 4 P4L, 5 Legal,
6 Legal L, 7 Env. 9.5x4.13, 8 C5 Env., 9 Other in mm), `e Printing Paper Source 1` (1 Top, 2 Bottom,
3 Bottom This Page Only, 4 Manual Feed). The PAGE FORMAT list runs from row 4 to about row 23, so `When finished…`
has to sit close to the prompt.

SCREEN FORMAT (ORG p.226): one item, `a Display Codes 2` with `1 = Yes 2 = No`.

### 2.5 PAGINATE DOCUMENT (ORG p.210)

The POSSIBLE CHOICES for item a are `1 - n`, where n is the document's current page count ("5" in the facsimile).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                           PAGINATE DOCUMENT                                       
 5                                                                                   
 6                                          YOUR     POSSIBLE                        
 7     ID  ITEM                             CHOICE   CHOICES                         
 8                                                                                   
 9     a   Paginate From Page               1        1 - 5                           
10                                                                                   
11     b   Paginate on Exact Line Count     2        1 = Yes    2 = No               
12                                                                                   
13     c   Adjust Line Endings              1        1 = Yes    2 = No               
14                                                                                   
15     d   Adjust Page Endings              1        1 = Yes    2 = No               
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

### 2.6 PRINT DOCUMENT (TB2 p.156; ORG p.212)

This is the best facsimile: it is evenly spaced, so the row numbers below are read straight off it. To print one copy of everything, press ENTER (ORG p.212).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                            PRINT DOCUMENT                                         
 5                                                                                   
 6                             YOUR     POSSIBLE                                     
 7     ID  ITEM                CHOICE   CHOICES                                      
 8                                                                                   
 9     a   Print From Page     0        0 = First Page,                              
10                                      1 = 9999.9.9                                 
11     b   Print Through Page  0        0 = Last Page,                               
12                                      1 = 9999.9.9                                 
13     c   Print Quantity      1        1 - 99                                       
14                                                                                   
15     d   Paper Handling      2        1 = Cut Paper, Manual Feed                   
16                                      2 = Cut Paper, Automatic Feed                
17                                      3 = Continuous Paper                         
18                                                                                   
19     e   Cancel on Error     2        1 = Yes     2 = No                           
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

### 2.7 TEXTPACK REQUEST TASKS (REQST key; ORG p.238)
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                         TEXTPACK REQUEST TASKS                                    
 5                                                                                   
 6            ID    ITEM                                                             
 7                                                                                   
 8            a     Print Document                                                   
 9            b     Display Print Queue or Cancel Print Job                          
10            c     Change Printing Order                                            
11            d     Display Index of Diskette Contents                               
12            e     Continue Printing With Element Now On Printer                    
13            f     Request Printer                                                  
14            g     Release Printer                                                  
15            h     Start Printer                                                    
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```
`Release Pinter` [sic] is the facsimile's typo on ORG p.238. The explanation page has `Release Printer`.

DISPLAY PRINT QUEUE OR CANCEL PRINT JOB (ORG p.134; TB2 p.158) has columns `ID   DISKETTE NAME   DOCUMENT NAME`.
The job now printing is marked `#` before its ID, with a footnote `# This document is printing now.`
Prompt: `Type ID letter to cancel print job; press ENTER:`. The queue holds at most **6** jobs (ORG p.134; TB2 p.157).
CHANGE PRINTING ORDER (ORG p.107; TB2 p.159) has the same layout. Prompt: `Type ID letter of document to be printed next; press ENTER: _`.

### 2.8 DISKETTE CONTENTS (Display Index) (ORG p.132)
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Displaying Index    |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4   Diskette: DISK01    Available: 70%     Unusable: 0%   Displaying: 1 to 4 of 4   
 5                                                                                   
 6    DOCUMENT NAME         TYPE                     COMMENT                         
 7     Mtg Ltr A          Document                 First Notice                      
 8     Mtg Ltr B          Document                 Second Notice                     
 9     Names              File                     Name and Address List             
10     Donor Shell        Document                 Letter to Donors                  
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                     END OF INDEX OF DISKETTE CONTENTS                             
23   * indicates that document needs recovery.                                       
24   Press ↓ key or ↑ key to see more.       When finished, press ENTER.             
25                                                                                   
```
The TYPE column holds `Document`, `File`, `File Setup`, `Sys. Doc.` or `Unknown` (ORG p.133). The arrow keys scroll long indexes.

### 2.9 SPELLING TASKS, CHECK DOCUMENT, HYPHENATE AND PAGINATE DOCUMENT
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                            SPELLING TASKS                                         
 5                                                                                   
 6               ID    ITEM                                                          
 7                                                                                   
 8               a     Check Document                                                
 9               b     Load Supplement                                               
10               c     Clear Supplement                                              
11               d     Store Supplement On Program Diskette                          
12               e     Choose Spelling Language Dictionary                           
13               f     Create Document Of Supplemental Words                         
14               g     Go To Task Selection                                          
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                             CHECK DOCUMENT                                        
 5                                                                                   
 6                                    YOUR     POSSIBLE                              
 7    ID ITEM                         CHOICE   CHOICES                               
 8                                                                                   
 9    a  Kind Of Spelling Check         1      1 = Prompted  2 = Automatic           
10                                             3 = None                              
11                                                                                   
12    b  System Page Number(s)                                                       
13       For Spelling Check                                                          
14                                                                                   
15    c  Hyphenation/Pagination         1      1 = Yes       2 = No                  
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                        HYPHENATE AND PAGINATE DOCUMENT                            
 5                                                                                   
 6                                          YOUR     POSSIBLE                        
 7     ID  ITEM                             CHOICE   CHOICES                         
 8                                                                                   
 9     a   Dictionary Hyphenation             1      1 = Prompted 2 = Automatic      
10                                                   3 = None                        
11     b   Paginate, Hyphenate, Spell                                                
12         Check from Page                    1      1 - 5                           
13     c   Paginate On Exact Line Count       2      1 = Yes      2 = No             
14     d   Print Paginated Pages              1      1 = Yes      2 = No             
15     e   Paper Handling                     1      1 = Cut Paper,Manual Feed       
16                                                   2 = Cut Paper,Automatic Feed    
17                                                   3 = Continuous Paper            
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

CHECK SPELLING OF WORD (ORG p.110). The document stays in the top half, with the unknown word **highlighted on the third
text line** (row 6 here). The instruction panel takes the bottom half. It has no ID letters.
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1   Spell Check         |Assets              |    |    |U.S. English       |        
 2 _ DISK01|      |                    |Pg. 2        |Ln. 53   |Kyb 1     |          
 3                                                                                   
 4            practical for items with a high unit price.                            
 5                                                                                   
 6       2.   First in, first out, or FIFO, is another method of costing             
 7            inventory. It assumes that the first units purchased are the           
 8            first units sold, that those still in inventory are the last           
 9            ones purchased.                                                        
10                                                                                   
11       3.  Last in, first out assumes the opposite -- that the last goods          
12           purchased are the first ones sold.                                      
13     <===================== CHECK SPELLING OF WORD =====================>          
14                                                                                   
15      To leave highlighting and continue:            Press SPELL                   
16      To remove highlighting and continue:           Press ENTER                   
17      To retype and revise word:                     Retype the word.              
18                                                     Press ENTER.                  
19                                                                                   
20      Check spelling of word:                                                      
21      FIFO                                                                         
22                                                                                   
23                                                                                   
24   Retype word; Press ENTER.                                                       
25                                                                                   
```

### 2.10 WORK DISKETTE TASKS and its menus (ORG p.244)
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                         WORK DISKETTE TASKS                                       
 5                                                                                   
 6                  ID   ITEM                                                        
 7                                                                                   
 8                  a    Delete Document                                             
 9                  b    Duplicate Document                                          
10                  c    Change Document Name                                        
11                  d    Change Diskette Name                                        
12                  e    Duplicate Diskette                                          
13                  f    Condense Diskette                                           
14                  g    Erase or Initialize (Name) Diskette                         
15                  h    Recover Documents                                           
16                  i    Print Index of Diskette Contents                            
17                  j    Display Final-form Document                                 
18                  k    Convert Final-form Document                                 
19                  l    Go to Task Selection                                        
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

DUPLICATE DOCUMENT (ORG p.137). Same diskette means a different name is required. If the new name equals an existing text document,
the copy is **appended** to it (ORG p.137–138).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|      |                    |             |         |Kyb 1     |          
 3                                                                                   
 4                          DUPLICATE DOCUMENT                                       
 5                                                                                   
 6                                        YOUR                                       
 7     ID  ITEM                           CHOICE                                     
 8                                                                                   
 9     a   Document Name                                                             
10     b   Diskette Name                                                             
11                                                                                   
12     c   New Document Name                                                         
13     d   Diskette Name                                                             
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

ERASE OR INITIALIZE (NAME) DISKETTE, dual unit (ORG p.144). The single-unit version has no items, just
`Insert diskette to be erased or initialized in diskette slot:` / `Press ENTER.` (ORG p.143).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |                    |    |    |                   |        
 2 _ DISK01|******|                    |             |         |Kyb 1     |          
 3                                                                                   
 4                        ERASE OR INITIALIZE(NAME) DISKETTE                         
 5                                                                                   
 6                                        YOUR          POSSIBLE                     
 7     ID  ITEM                           CHOICE        CHOICES                      
 8                                                                                   
 9     a   Diskette Slot                                1 = Left                     
10                                                      2 = Right                    
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18    Insert Diskette to be Erased or Initialized into diskette slot.                
19                                                                                   
20                                                                                   
21                                                                                   
22   When finished with this menu, press ENTER.                                      
23                                                                                   
24   Type ID letter to choose ITEM; press ENTER: _                                   
25                                                                                   
```

Other work-diskette menus, all in the same `a/b … YOUR CHOICE` form:
* DELETE DOCUMENT: `a Document Name`, `b Diskette Name` (ORG p.130)
* CHANGE DOCUMENT NAME: `a Name of Document`, `b Document Comment`, each up to 44 characters, with current values shown (ORG p.100)
* CHANGE DISKETTE NAME (dual): `a Diskette Name (Left Slot)`, `b Diskette Name (Right Slot)` (ORG p.99)
* DUPLICATE DISKETTE and CONDENSE DISKETTE: `a From Diskette Name`, `b To Diskette Name`. The system may pre-fill them (ORG p.135–136, p.118)
* RECOVER DOCUMENTS (dual): `a Diskette Slot 1 = Left 2 = Right` plus `Insert diskette to be recovered into diskette slot; press ENTER.` (ORG p.219)

Diskette names are up to 6 characters (TP4 p.2–3). Document names and comments are up to 44 characters, and case matters
(ORG p.100; TB1 p.8).

---

## 3. The typing screen

### 3.1 Layout on entry (Create)
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |First Letter        |Ins |    |                   |        
 2 _ DISK01|      |                    |Pg. 1        |Ln. 7    |Kyb 1     |Pitch 12  
 3   .«.2....:....3....:....4....:....5...▼:....6....:....7....:....8....:....»....:.
 4    ▲                                                                              
 5                                                                                   
 6                                                                                   
 7                                                                                   
 8                                                                                   
 9                                                                                   
10                                                                                   
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24                                                                                   
25                                                                                   
```

* Row 1: field B holds the document name and field C holds `Ins`. Insert mode is the default. CODE+INSERT/REPLACE (the `8` key)
  toggles to `Repl` and back (TB1 p.18–19).
* Row 2: `Pg. 1`, then `Ln. 7`, because the line count is measured from the top edge of the paper and the default First Typing Line is 7 (ORG p.30–31;
  TB2 p.62). Then `Kyb 1` and `Pitch 12`.
* Row 3 is the scale line. With default margins 18/90 the screen shows **scale positions 17–96** (column 1 = position 17), measured from ORG p.29–30.
  Characters: `.` for ordinary positions, `:` at every 5, the tens digit at every 10 (`2` = 20 … `8` = 80), `«`/`»` at the margins
  (written `<<`/`>>` in some figures; **UNCLEAR** whether one or two cells), and `▼` at the center point, position 54 (TB1 p.21).
  Tab stops are marked by an **underscore under the scale position**, every 5 positions by default (TB2 p.62; drawing on ORG p.29).
  Other tab kinds have their own glyphs: center `|●|`, decimal `•`, comma `,`, flush-right an underlined `+` (ORG p.31).
  A `■` on the scale line marks the right paper edge (ORG p.561; TB2 p.55). The scale position matching the cursor is
  **highlighted** (ORG p.31).
* Row 4 holds the cursor, which is a brightened short underline. The character above it is also highlighted (ORG p.32; TB1 p.10). When typing
  starts, the cursor sits under the **Page End symbol `▲`** (a solid up-triangle, ORG p.560). The symbol travels with the cursor and
  marks the end of the page's text (TB1 p.10). Rows 4–23 are the 20 text lines.

### 3.2 Typing, wrap and line endings

* Word wrap ("Auto Carrier Return / Auto Adjust" = On by default): a word that would pass the right margin moves to the next line,
  and text re-adjusts between the margins as it is inserted or deleted (ORG p.247; TB1 p.11).
* With wrap off (Adjust Line Endings = No, in headers and footers, or in PSM with No), the system **beeps** as the typing approaches the right
  margin, like a typewriter bell. The operator must press RET (TB2 p.161, p.464, p.572).
* Display spacing: double spacing still shows **single-spaced** on screen. `Ln.` goes up by 2 per line (TB1 p.35, p.38).
  PSM text shows in 12 pitch, so line ends on screen may differ from print (TB2 p.161).
* A **beep sounds at the Last Typing Line** (line 60 by default). The operator may ignore it and keep typing one long page that is paginated later
  (TB2 p.59, p.63), or press PAGE END at the beep to paginate by hand (TB2 p.63; WSPG p.114). **CONFLICT:** WSPG p.114
  says "You cannot type past the point at which the Page End Tone sounds", but TB2 p.59–60 has the trainee type well past line 60.
  I suggest allowing it, beeping, and producing a "Long page" error at print time (TB2 p.652).

### 3.3 Stored codes on screen

* Codes are hidden by default. A code becomes visible **only when the cursor is under it**: the symbol shows in place
  and its name appears in status field E (TB1 p.24, p.26; TB2 p.113, p.116; ORG p.558).
* **Display Codes = Yes** (CODE+SCREEN FORMAT, then `a 1`) shows every code. Each takes a cell and pushes the text right,
  so "the text looks funny" (TB1 p.39; WSPG p.86).
* Glyphs (ORG pp.558–562): Carrier Return `↵` (a hooked left arrow); Req'd Carrier Ret, a hooked arrow with a bar; Tab `→|`; Req'd Tab
  `→|` with a heavier stem; Page End `▲`; Required Page End, an hourglass `⧗`; Required Space `▼`; Required Hyphen, a `▼` with a bar;
  Word Und `xx` underlined; Und, a short underscore; Ctr `|●|`; Begin/End Und, an arrow with a small x; Begin/End Keep, Begin Table and End Table `‡`
  with an arrow; Index, a down arrow with bars; Half Index Up/Down `↑`/`↓`; Line/Page Format Change, a boxed `F`;
  Line/Page Format Return, a boxed `R`; Start Alternate Fmt, a boxed `2`; Instruction-type codes (Include, Math, Pg. Number, System Pg. Number, Conditional,
  Spelling) `++`/`#`-like double crosses; Stop, Switch, Null, Unassigned and Spelling Mark, a solid `■`; Substitute, a long dash `—`.
  We draw our own glyphs to match these shapes.
* Underlined text is shown underlined (TB1 p.21–22). Spelling-marked words stay **highlighted** on screen but do not print
  (TB2 p.75). Selected text (Delete what? / Move what? / Copy what?) is highlighted as the cursor moves (TB1 p.17, p.26).

### 3.4 Scrolling, segmenting and pages

* Vertical: the display shows 20 lines. When the cursor reaches the top or bottom edge, the text **scrolls** (ORG p.32; TB1 p.17).
* Horizontal: lines can be wider than 80 columns. When the cursor reaches the screen edge, the text and the scale line
  **segment**, jumping sideways. The exact jump width is **UNCLEAR** (ORG p.32 diagram only). TB1 p.17 says the display "shifts"
  and moves back when the cursor goes up and left.
* SCREEN RIGHT/LEFT/DOWN/UP keys move the window in blocks (ORG p.33). Block size **UNCLEAR**.
* CODE+↑/↓ go to the top/bottom of the *page*. CODE+←/→ go to the far left/right of the line (TB1 p.27).
* **One page at a time:** the typing area shows one system page. `Pg. n` names it (ORG p.30). To change page, use
  **GO TO** (`Type page number; press ENTER`; ENTER alone means the next page) (TB2 p.112, p.117, p.121). FIND searches forward only
  (TB1 p.28; TB2 p.121). The page boundary itself is the `▲` Page End code at the end of the text. After pagination pages
  end where the system put them. Pages added during revision get decimal numbers such as `9999.9.9` (implied by the PRINT DOCUMENT
  choice range, ORG p.212; **UNCLEAR**).
* Cursoring into a place where you cannot type (e.g. to the right of a carrier return) shows `Non-Typing Area` in field E (ORG p.560).

### 3.5 Prompts during functions

These show on row 24 (prompt line). The status field A names the function: `Delete what?` (TB1 p.17), `Move what?` then `To where?` (TB1 p.26),
`Copy what?` then `To where?` (TB2 p.55–56), `Find what?` (TB1 p.27–28; pressing SPELL at Find shows a symbol meaning "marked word",
TB2 p.72), `Type page number; press ENTER` (TB2 p.112). DEL, then typing a character: everything from the cursor through the first
occurrence of that string is highlighted (TB1 p.23). Delete what? then ENTER with nothing typed deletes the code or character
under the cursor (TB1 p.24). After `Delete what?`:
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |Smith Letter        |Ins |    |                   |        
 2 _ DISK01|      |                    |Pg. 1        |Ln. 12   |Kyb 1     |Pitch 12  
 3   .«.2....:....3....:....4....:....5...▼:....6....:....7....:....8....:....»....:.
 4    ... text of Smith Letter, the word "regular" shown in reverse video ...        
 5                                                                                   
 6                                                                                   
 7                                                                                   
 8                                                                                   
 9                                                                                   
10                                                                                   
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24   Delete what?                                                                    
25                                                                                   
```

---

## 4. Worked examples (keystroke scripts with expected screens)

Notation: `"text"` = type characters; `ENTER`, `RET` (carrier return), `END`, `DEL`, `MOVE`, `FIND`, `GO TO`, `MSG`, `REQST`,
`SPELL`, `CODE+X`; `↓`,`→` = cursor keys. "S:" = expected screen after the step. Unless noted, the diskettes are:
program in the left slot, work diskette `TRAIN` in the right slot.

### E1. Power on and reach TASK SELECTION (TP4 p.1; ORG p.58–59)
1. Power on with no diskettes. S: blank, then the BAT codes at row 20 col 10 (`05`, `06`, `09`) and finally `*11*` (or `*15*`) with the large IBM initials.
2. Insert the Vol. 01 program diskette and close the lever. S: screen clears, row 1 = `Loading Program`. The drive is busy for about 10 s.
3. S: TASK SELECTION (§2.1), prompt `Type ID letter to choose ITEM; press ENTER: _`.

### E2. Create a short letter (TB1 p.7–11)
1. `"a"` `ENTER` (Typing Tasks). S: prompt for the Vol. 02 diskette if it is not loaded, then TYPING TASKS (§2.2).
2. `"a"` `ENTER` (Create Document). S: row 24 `Type document name; press ENTER.`
3. `"First Letter"` `ENTER`. S: row 24 `Type diskette name; press ENTER.` (it may be pre-filled with the inserted name).
   If the name already exists: message `(First Letter) already exists` (TB1 p.8; TB2 p.648).
4. `"TRAIN"` `ENTER`. S: CREATE OR REVISE DOCUMENT (§2.3), row 22 `When finished with this menu, press ENTER.`
5. `ENTER`. S: typing area (§3.1): `▲` at row 4 col 2, `Pg. 1`, `Ln. 7`, `Ins`.
6. Type the paragraph with no RET. S: the text wraps at position 90. `Ln.` follows the cursor line. `▲` follows the last character (screen as below).
7. `END`. S: the document is stored on TRAIN, and TYPING TASKS returns (TB1 p.11).
```text
              1         2         3         4         5         6         7         8
     12345678901234567890123456789012345678901234567890123456789012345678901234567890
 1                       |First Letter        |Ins |    |                   |        
 2 _ DISK01|      |                    |Pg. 1        |Ln. 11   |Kyb 1     |Pitch 12  
 3   .«.2....:....3....:....4....:....5...▼:....6....:....7....:....8....:....»....:.
 4    Bobby -- I just want to drop you a short note to tell you that I landed        
 5    safely and that everything is going just great. Hawaii is every bit as         
 6    exciting as they say. The people are friendly and relaxed, and the scenery     
 7    is breathtaking. If the weather is good tomorrow, I'm going to try scuba       
 8    diving. See you all soon.▲                                                     
 9                                                                                   
10                                                                                   
11                                                                                   
12                                                                                   
13                                                                                   
14                                                                                   
15                                                                                   
16                                                                                   
17                                                                                   
18                                                                                   
19                                                                                   
20                                                                                   
21                                                                                   
22                                                                                   
23                                                                                   
24                                                                                   
25                                                                                   
```

### E3. Print the document (TB1 p.12–15; TB2 p.156; ORG p.212)
1. From TYPING TASKS: `"e"` `ENTER` (TB1 says `d`, a **CONFLICT** with ORG p.240; use `e` for Textpack 4).
   S: `Type document name; press ENTER.` pre-filled `First Letter` (last document used).
2. `ENTER`. S: `Type diskette name; press ENTER.` pre-filled `TRAIN`.
3. `ENTER`. S: PRINT DOCUMENT (§2.6).
4. `ENTER`. S: the job is queued and TYPING TASKS returns. A **tone** sounds and a **blinking arrow** appears at bottom left
   (row 25 col 1) (TB1 p.13).
5. `MSG`. S: row 25 shows a message asking for the printer to be turned on (wording **UNCLEAR**; in the other researcher's list).
6. (Printer on.) Tone, arrow, `MSG`. S: a request to load paper (TB1 p.14). Load and START.
7. Tone, arrow, `MSG`. S: a printwheel/element message, e.g. `Put on printer element 086 001` (TB1 p.14–15, for the 5215). START.
   The page prints and the paper indexes out. Tone, arrow.
8. `MSG`. S: a message confirms the document printed. `MSG` again clears the message line (TB1 p.15).
   The operator can keep working (create another document) while the job prints (TB2 p.157).

### E4. Print 2 copies using the menu shortcut (TB1 p.29, p.41)
1. TYPING TASKS: `"e"` `ENTER`, `ENTER`, `ENTER` (accept the suggested names). S: PRINT DOCUMENT.
2. `"c 2"` `ENTER`. S: the YOUR CHOICE for `c Print Quantity` shows **`2` highlighted**. The prompt returns to `Type ID letter to choose ITEM; press ENTER:`.
   (Long form: `"c"` `ENTER` → `Type YOUR CHOICE; press ENTER` → `"2"` `ENTER`.)
3. `ENTER`. S: queued, as in E3.

### E5. Revise: delete a word, insert a word, replace a letter (TB1 p.16–19)
1. TYPING TASKS: `"b"` `ENTER`, `"Smith Letter"` `ENTER`, `"TRAIN"` `ENTER`, `ENTER`. S: the first 20 lines of page 1 in the typing area.
2. `↓`/`→` until the cursor is under the `r` of `regular`. S: that `r` highlighted, the scale cursor at the matching position.
3. `DEL`. S: row 24 `Delete what?`.
4. `→` ×7 (through `regular` and its following space; the guide simply says "the word"). S: `regular` highlighted.
5. `ENTER`. S: the word disappears and the line re-adjusts. The prompt line clears.
6. `"large"`. S: inserted at the cursor, text to the right pushed over (insert mode).
7. Move to `T` in the signature line. `CODE+INSERT/REPLACE`. S: row 1 field C `Repl`.
8. `"R"`. S: `T` is replaced by `R`. `CODE+INSERT/REPLACE` again. S: field C `Ins`.
9. `END`. S: TYPING TASKS.
Recovery: CODE+CANCL at any `Delete what?` stage clears the highlighting and the prompt (TB1 p.17).

### E6. Delete a whole paragraph by target string (TB1 p.23–24)
1. Revise `Smith Letter`. Cursor under `If`, the first word of paragraph 3.
2. `DEL`, then `"necessary."` S: everything from the cursor through the first `necessary.` is highlighted (the whole paragraph).
3. `ENTER`. S: the paragraph is gone.
4. Blank-line deletion: cursor to the start of an empty line. S: a highlighted `↵` appears and field E reads `Carrier Return`.
   `DEL` `ENTER` removes it.

### E7. Move a paragraph (TB1 p.25–26; across pages TB2 p.116–117)
1. Revise `Promotions`. `↓` to the left margin of the paragraph's first line. S: the `→|` tab glyph is visible under the cursor and field E reads `Tab`.
2. `MOVE`. S: row 24 `Move what?`.
3. `↓`/`→` to three positions past the final period, so the `↵` is included. S: the paragraph is highlighted and `↵` shows at the end.
4. `ENTER`. S: row 24 `To where?`.
5. Cursor to the left margin of the last paragraph's first line, then `ENTER`. S: the paragraph is re-inserted there and the text reflows.
   Across pages: at `To where?` press `GO TO` `ENTER` (next page), position the cursor, then `ENTER` (TB2 p.117).

### E8. Find (TB1 p.27–28)
1. In the typing area: `FIND`. S: `Find what?`. `"the"` `ENTER`. S: the cursor is under the first `the` after it, including inside words such as `mother`.
2. `FIND` `ENTER` repeats the last target (TB2 p.113). Find never goes backwards (TB1 p.28).

### E9. Paginate a long document (TB2 p.58–63)
1. Create `Change` on TRAIN with double spacing (CREATE OR REVISE `"b"` ENTER → FORMAT SELECTION `"a"` ENTER → LINE FORMAT `"a 2"` ENTER,
   ENTER ×3 back to the typing area). Type about 2 pages without PAGE END. S: a **beep** after typing `Ln. 60`. Typing continues.
2. `END`. S: TYPING TASKS.
3. `"c"` `ENTER`, `"Change"` `ENTER`, `"TRAIN"` `ENTER`. S: PAGINATE DOCUMENT (§2.5).
4. `ENTER`. S: row 1 field A `Paginating Document`. When done: message `(Change) paginated` and back to TYPING TASKS (TB2 p.62).
   Pagination uses margins 18 & 90, tabs every 5, line spacing, First Typing Line 7 and Last Typing Line 60 (TB2 p.62).
   Menu-bypass alternative: `CODE+MENU BYPASS` `"paginate Change"` … (TB2 p.63).

### E10. Spelling check, hyphenate, paginate (TB2 p.68–73)
1. Revise `Assets` on TRAIN and go to the typing area. `SPELL`. S: the document ends. TASK SELECTION flashes with `Spelling Tasks` highlighted,
   the Spelling program loads, then SPELLING TASKS with `Check Document` highlighted.
2. S: `Type document name; press ENTER` (pre-filled) `ENTER`. `Type diskette name; press ENTER` `ENTER`. S: CHECK DOCUMENT (§2.9).
3. `ENTER`. S: HYPHENATE AND PAGINATE DOCUMENT.
4. `"d"` `ENTER`, `"2"` `ENTER` (no printing). `ENTER`. S: that menu stays up while checking runs. It then stops on
   `exampel`, showing the CHECK SPELLING OF WORD screen (§2.9) with the word highlighted on text line 3.
5. `"example"` `ENTER` (retype). S: the word is replaced and checking continues.
6. On `contra`: `SPELL` (leave it highlighted). On `FIFO`: `ENTER` (remove the highlighting, this time only). On `ABC`: `ENTER`. After that
   it is not stopped on again in this document (TB2 p.70–71).
7. Hyphenation stop on `company's`: the cursor is at the suggested hyphen point. `→` past the last letter, then `ENTER` (keep the whole word).
   On `materials`: `ENTER` (hyphenate there). The rules are on TB2 p.71: cursor on the first letter moves the word down; past the end keeps it.
8. S: TASK SELECTION flashes and TYPING TASKS returns with `Revise Document` highlighted. `MSG` → `(Assets) paginated`.
   `MSG` → `Spelling Check complete. Words marked: 1` (TB2 p.72).
9. Revise `Assets` (ENTER, ENTER on the pre-filled prompts). `FIND`, then `SPELL` at `Find what?`, then `ENTER`. S: the cursor is on `contra`.
   `CODE+CANCL` removes the highlight. `END`.

### E11. Copy a document to another diskette (ORG p.364–365, menu ORG p.137)
1. TASK SELECTION `"b"` `ENTER` (insert Vol. 03 if prompted). S: WORK DISKETTE TASKS.
2. `"b"` `ENTER`. S: DUPLICATE DOCUMENT (§2.10).
3. `"a First Letter"` `ENTER`, `"b TRAIN"` `ENTER`, `"c First Letter"` `ENTER`, `"d DISK02"` `ENTER` (each value highlighted under YOUR CHOICE).
4. `ENTER`. S: diskette activity, then a message saying the document is duplicated (wording **UNCLEAR**). END before the final ENTER aborts (ORG p.366).

### E12. Initialise and name a new work diskette (TP4 p.2–3; ORG p.144)
1. Insert the blank diskette in the right slot. S: row 2 field H `******` (TP4 p.2).
2. TASK SELECTION `"b"` `ENTER`; WORK DISKETTE TASKS `"g"` `ENTER`. S: ERASE OR INITIALIZE (NAME) DISKETTE (§2.10).
3. `"a"` `ENTER`, `"2"` `ENTER` (right slot). `ENTER`, then `ENTER` again (TP4 p.2 lists two ENTERs, one presumably a
   confirmation; the wording is **UNCLEAR**).
4. A blank diskette prompts for a name (up to 6 characters): `"WORK01"` `ENTER`. S: **no progress indicator**. Only the drive is heard (TP4 p.3).
   An already-named diskette keeps its name and skips this step (TP4 p.2).
5. When done: `"l"` `ENTER` returns to TASK SELECTION (TP4 p.3).

### E13. Show codes (TB1 p.39–40)
1. In the typing area: `CODE+SCREEN FORMAT`. S: SCREEN FORMAT menu. `"a 1"` `ENTER`, `ENTER`. S: all the codes visible inline, text pushed right.
2. `CODE+↑` (top of page), `FIND`, `CHG FMT` (the target is the format-change code), `ENTER`. S: the cursor is under the boxed-F symbol.
   `ENTER` opens that FORMAT SELECTION. `ENTER` returns.

---

## 5. Feel: waits, busy indications and sounds

**Audible signals (a single keyboard tone; pitch and length are not documented, so synthesise a short beep):**
* when a message arrives on the message line (with the blinking arrow) (TB1 p.13–14);
* at the Last Typing Line while typing (the page-end tone) (TB2 p.59, p.63; WSPG p.113–114, p.120, p.133);
* near the right margin when Auto CR is off (headers/footers, Adjust Line Endings = No, PSM with No) (TB2 p.161, p.172, p.219, p.464, p.572);
* for messages from a hidden alternate task, controlled by `Tone in Alternate Task` (TB2 p.596; ORG p.246);
* during program-diskette combining, a beep goes with each insert-diskette message (TB2 p.523).
* **UNCLEAR:** whether invalid keys (for example arrow keys in a menu) beep. ORG p.32 says only "they will not operate".

**Message mechanics:** messages queue. The blinking arrow at bottom left shows that one or more are waiting. Each MSG shows the
next one and the last MSG clears the line (TB1 p.13–15; ORG p.480). In Alternate Tasks an unread message is erased by the next keystroke unless MSG is
pressed (ORG p.253).

**Busy indications and waits:**
* `Loading Program` on status line 1 during IPL, about 10 s (TP4 p.1). TB1 p.6 gives about 30 s of drive clicking (older program).
* Program swaps between task families: TASK SELECTION flashes with the next task highlighted while the program "loads" (TB2 p.68, p.74).
  The time is not stated.
* `Paginating Document` on status line 1 during pagination, ending with the message `(name) paginated` (TB2 p.62).
* `Displaying Index` (ORG p.132), `Spell Check` (ORG p.110). While the spelling check runs, the HYPHENATE AND PAGINATE menu stays on screen (TB2 p.69).
* Formatting a diskette: no on-screen progress, only drive noise (TP4 p.3). Duplicate Diskette and Duplicate Document finish with a completion
  message (ORG p.364–365). Loading a spelling supplement also ends with one (ORG p.229).
* Printing runs in the background. The operator may keep working (TB2 p.157). The queue holds 6 jobs (TB2 p.157), and the PRINT key queues up to 25 pages
  per document (TB2 p.160; WSPG p.62). After using PRINT, pressing END "you may have to wait until the page that is printing has printed"
  (TB2 p.160). With Print Paginated Pages = Yes, no other task is possible until the last page is paginated and printed (TB2 p.69).
* Printer sharing: `Printer Available` appears once the printer is assigned to your station (WSPG p.70). Printwheel and paper prompts
  come when your queue starts printing (WSPG p.65).
* Blocking rules: no printing during Program Diskette Tasks (ORG p.237). Duplicate and condense cannot run during printing, and a queued
  job waits for them (ORG p.118–119, p.135–136). A document that is printing or queued cannot be revised: message
  `(Document) already in use` (TB2 p.650).
* Removing the work diskette before END leaves the document needing **recovery**. It is marked `*` in the index (TB1 p.11; ORG p.132).
  After recovery, lost characters show as `Substitute` codes (TB2 p.649).

---

## 6. Gaps and open questions

1. The exact row of menu titles (3 or 4), and how a 19-line menu such as TASK SELECTION fits. The facsimiles leave out or add blank rows.
2. Whether the status-line separator bars take up cells, and whether `«`/`»` are one cell or two.
3. Segment (horizontal jump) width, and the step size of the SCREEN UP/DOWN/LEFT/RIGHT keys.
4. The exact wording of the program-volume swap prompt and of the print-progress messages (printer on, load paper, printed, duplicated).
   The *Prompts and Messages Guide* S544-2122 is not in our set. The other researcher's ORG pass may have some of them.
5. Timings beyond IPL. No source gives save, page-read or pagination durations. Use the diskette timing model.
6. TB1 vs ORG item letters (Print = `d` vs `e`) and the TP4 recipe "Create = A, B" (TP4 p.4; it should be A then a). **CONFLICT**. Follow ORG/TB2.
7. Whether you can type past the Last Typing Line (WSPG p.114 vs TB2 p.59).
8. Whether case matters for ID letters at menu prompts (manuals print lower case; TP4 uses capitals).
