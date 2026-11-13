// The sticky notes' steps are real: each note's keystrokes, typed into the software, do what the note says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, run, row, findOnScreen } from '../src/wp/testkit.js';
import { NOTES } from '../src/render/wp/postits.js';

test('the notes say what the software does: create, save, print, back to the main menu', () => {
  assert.deepEqual(NOTES.map((n) => n.id), ['keys', 'type', 'print']);
  const { sys } = boot({ work: ['WORK01'] });
  // New document: a ENTER, a ENTER, name ENTER, WORK01 ENTER, ENTER, type, RET, END.
  run(sys, 'a ENTER a ENTER "Letter" ENTER "WORK01" ENTER ENTER "Hello." RET "Second line" END');
  assert.ok(findOnScreen(sys, 'TYPING TASKS', 1, 23), 'END saves and returns to Typing Tasks');
  // Print it: e ENTER, name ENTER, WORK01 ENTER, ENTER.
  run(sys, 'e ENTER "Letter" ENTER "WORK01" ENTER');
  assert.ok(findOnScreen(sys, 'PRINT DOCUMENT', 1, 23));
  run(sys, 'ENTER');
  assert.ok(findOnScreen(sys, 'TYPING TASKS', 1, 23));
  // ==> : MSG reads the message, the printer asks for its element; REQST e ENTER answers that it is on.
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Put on printer element/);
  run(sys, 'REQST e ENTER');
  // Revise: b, the same way, once the printer is done with it (a document being printed is "already in use").
  sys.runUntilIdle();
  run(sys, 'b ENTER "Letter" ENTER "WORK01" ENTER');
  assert.ok(findOnScreen(sys, 'CREATE OR REVISE DOCUMENT', 1, 23));
  run(sys, 'ENTER');
  assert.ok(findOnScreen(sys, 'Hello.', 4, 23), 'the saved text comes back');
  run(sys, 'END f ENTER');
  assert.ok(findOnScreen(sys, 'TASK SELECTION', 1, 23), 'f ENTER = main menu');
});
