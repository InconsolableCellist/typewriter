// Every fixed text the FO-70's 16-digit LCD shows, in one table, and the error codes printed on reports.
//
// mark: 'S'  the wording as printed in the owner's manuals, `page` where: "OM p.N" the FO-10/FO-50/FO-70 operation
//            manual (docs/fax/refs/sharp_fo10_50_70_operation_manual.pdf; page N is the printed page, its figure is
//            PDF page N + 102), "SM p.N-M" the service manual (docs/fax/refs/sharp_fo70_service_manual.pdf). The
//            operation manual's "Messages and Signals" (OM p.90-91) and its procedures' display figures are the
//            source for what a user sees; the service manual's for power on and the diagnostics.
//       'A'  ours: a text the manuals do not show (what the LCD says while dialling or sending, for instance).
// Texts are at most 16 characters, in the LCD's character set (panel.js).

const S = (text, page, note) => ({ text, mark: 'S', page, ...(note ? { note } : {}) });
const A = (text, note) => ({ text, mark: 'A', ...(note ? { note } : {}) });

export const MESSAGES = Object.freeze({
  // Power on (SM p.7-2/pdf80): the machine has no power switch (OM p.13).
  WAIT_MOMENT:     S('WAIT A MOMENT', 'SM p.7-2', 'while the CPU and modem initialise; STOP here offers the memory clear'),
  MEMORY_CLEAR_Q:  S('MEMORY CLEAR?', 'SM p.7-2', 'START clears; nothing for 3 s returns to standby'),
  MEMORY_CLEARED:  S('MEMORY CLEARED', 'SM p.7-2'),
  // Messages and Signals, display messages (OM p.90-91), in the manual's order.
  CHECK_PAPER:     S('CHECK PAPER', 'OM p.90', 'the thermal paper is jammed or is not loaded properly'),
  COVER_OPEN:      S('COVER OPEN', 'OM p.90', 'the operation panel is open'),
  DOC_JAMMED:      S('DOCUMENT JAMMED', 'OM p.90', 'START tries to feed it out (OM p.92)'),
  FUNCTION_MODE:   S('FUNCTION MODE', 'OM p.90', 'the FUNCTION key has been pressed'),
  HOLD:            S('HOLD', 'OM p.90', 'HOLD/SEARCH during a phone conversation'),
  LINE_BUSY:       S('LINE BUSY', 'OM p.90', 'busy or no answer on automatic dialling; STOP clears it'),
  LINE_ERROR:      S('LINE ERROR', 'OM p.90', 'transmission or reception was not successful; STOP clears it'),
  NO_DATA:         S('NO DATA', 'OM p.90', 'a search with no numbers stored'),
  NOT_STORED:      S('NO # STORED', 'OM p.90', 'a rapid key or speed dial number with no number in it'),
  OFF_HOOK:        S('OFF HOOK', 'OM p.90', 'the handset left off after dialling and sending a fax'),
  ON_HOOK_DIAL:    S('ON HOOK DIAL', 'OM p.91', 'SPEAKER pressed: waiting for you to dial'),
  OUT_OF_PAPER:    S('OUT OF PAPER', 'OM p.91, p.19'),
  OVER_HEAT:       S('OVER HEAT', 'OM p.91', 'the print head has overheated'),
  PAPER_JAMMED:    S('PAPER JAMMED', 'OM p.91, p.93'),
  DOC_READY:       S('READY TO SEND', 'OM p.91, p.33', 'a document is loaded'),
  RECALLING:       S('RECALLING', 'OM p.91', 'busy or no answer: the machine will redial'),
  SEARCH_DIAL:     S('SEARCH DIAL', 'OM p.91', 'HOLD/SEARCH pressed: # or * searches'),
  TOTAL_PAGES:     S('TOTAL PAGE(S)', 'OM p.91', '"TOTAL PAGE(S) 01": pages transmitted, received or copied'),
  // Receiving.
  RECEIVING:       S('RECEIVING', 'OM p.55', 'TEL mode: the handset can be replaced'),
  POLLING:         S('POLLING', 'OM p.80', 'E/POLL pressed after dialling; replace the handset'),
  // Caller ID (OM p.71-72).
  NO_SERVICE:      S('NO SERVICE', 'OM p.71'),
  CID_ERROR:       S('CALLER-ID ERROR', 'OM p.71'),
  PRIVATE_CALL:    S('PRIVATE CALL', 'OM p.71'),
  REVIEWING_CALLS: S('REVIEWING CALLS', 'OM p.72', 'HOLD/SEARCH 2'),
  // Volume (OM p.29-30): one VOLUME key, the speaker's while SPEAKER is on, the ringer's otherwise.
  SPEAKER_VOL:     S('SPEAKER:', 'OM p.29', 'SPEAKER: MIDDLE -> HIGH -> LOW'),
  RINGER_VOL:      S('RINGER:', 'OM p.30', 'RINGER: MIDDLE -> HIGH -> RINGER OFF: OK? -> LOW'),
  RINGER_OFF_Q:    S('RINGER OFF: OK?', 'OM p.30', 'START turns the ringer off'),
  // The FUNCTION modes (setup.js).
  M_LIST:          S('LISTING MODE', 'OM p.81', 'FUNCTION 2'),
  L_JUNK:          S('JUNK #', 'OM p.81', '* in LISTING MODE: the Anti Junk Number List'),
  L_TEL:           S('TELEPHONE #', 'OM p.81', '# in LISTING MODE: the Telephone Number List'),
  M_ENTRY:         S('ENTRY MODE', 'OM p.20', 'FUNCTION 3'),
  M_FAXTEL:        S('FAX/TEL. # MODE', 'OM p.41', 'FUNCTION 3 #; the quick reference and the service manual print "FAX/TEL # MODE"'),
  SET_CLEAR:       S('1=SET,2=CLEAR', 'OM p.41, p.77'),
  FAXTEL_SET:      S('FAX/TEL. # SET', 'OM p.41'),
  ENTER_SPEED:     S('ENTER SPEED #', 'OM p.41'),
  M_OWN:           S('OWN NUMBER SET', 'OM p.21', 'FUNCTION 3 # #'),
  ENTER_FAX_NO:    S('ENTER FAX #', 'OM p.21'),
  ENTER_YOUR_NAME: S('ENTER YOUR NAME', 'OM p.21'),
  M_DATE:          S('DATE & TIME SET', 'OM p.23, p.24', 'FUNCTION 3 # # #'),
  M_JUNK:          S('STORE JUNK #', 'OM p.77', 'FUNCTION 3 * *'),
  M_PRIORITY:      S('PRIORITY CALL #', 'OM p.73', 'FUNCTION 3 *'),
  M_OPTION:        S('OPTION SETTING', 'OM p.69', 'FUNCTION 4'),
  PRESS_STAR_HASH: S('PRESS * OR #', 'OM p.69', 'alternates with OPTION SETTING'),
  TONE_SELECTED:   S('TONE SELECTED', 'SM p.2-1'),
  PULSE_SELECTED:  S('PULSE SELECTED', 'SM p.2-1'),
  // Ours: what the manuals do not show.
  ENTER_NAME:      A('ENTER NAME', 'name entry for an auto-dial number (OM p.42 shows no display)'),
  SET_CLOCK:       A('DATE & TIME SET', 'after a cold start, in turn with the clock line'),
  SPEED_NO:        A('ENTER SPEED #', 'SPEED DIAL pressed: two digits 01-40 (OM p.46 shows no display)'),
  JUNK_NO:         A('ENTER (1-5)', 'STORE JUNK #: the number that identifies the entry (OM p.78 shows no display)'),
  DIALING:         A('DIALING'),
  SENDING:         A('SENDING'),
  INCOMING:        A('INCOMING CALL'),
  PICK_UP:         A('PICK UP HANDSET', 'TEL/FAX mode while the machine pseudo-rings a voice call'),
  TELEPHONE:       A('TELEPHONE'),
  BLOCKED:         A('RECEPT. BLOCKED', 'a junk fax refused'),
  COPYING:         A('COPYING'),
  PRINTING:        A('PRINTING'),
  // The diagnostic mode: FUNCTION 9 * 8 # 7 (SM p.2-2/pdf17). The ROM version for 2 s, then DIAG MODE; START, and the
  // items by * and # or their direct key. The item names are the manual's table; that the LCD shows them so is ours.
  ROM_VER:         S('ROM Ver. FZL0 *', 'SM p.2-2', 'FZK0 on the FO-50'),
  DIAG_MODE:       S('DIAG MODE', 'SM p.2-2'),
  D_SOFT:          S('SOFT SWITCH MODE', 'SM p.2-2'),
  D_ROMRAM:        S('ROM & RAM CHECK', 'SM p.2-2'),
  D_AGING:         S('AGING MODE', 'SM p.2-2'),
  D_PANEL:         S('PANEL CHECK MODE', 'SM p.2-2', 'printed "PANEL CKECK MODE" in the item table'),
  D_PATTERN:       S('CHECK PATTERN', 'SM p.2-2'),
  D_SIGNAL:        S('SIGNAL SEND MODE', 'SM p.2-2'),
  D_MEMCLR:        S('MEMORY CLEAR', 'SM p.2-2'),
  D_SHADING:       S('SHADING MODE', 'SM p.2-2'),
  D_BLACK:         S('ALL BLACK PRINT', 'SM p.2-2'),
  D_FEEDER:        S('AUTO FEEDER MODE', 'SM p.2-2'),
  D_ESEND:         S('ENTRY DATA SEND', 'SM p.2-2'),
  D_ERECV:         S('ENTRY DATA RECV.', 'SM p.2-2', '"ENTRY DATA RECEIVE", eighteen letters: abbreviated [A]'),
  D_CUTTER:        S('CUTTER AGING', 'SM p.2-2'),
  D_COUNTRY:       S('COUNTRY SELECT', 'SM p.2-2'),
});

/** The resolution and contrast display [OM p.37]: "STANDARD  :AUTO" ... "HALF TONE :DARK". */
export const resText = (res, contrast) => `${({ STANDARD: 'STANDARD', FINE: 'FINE', SUPERFINE: 'SUPER FINE', HALFTONE: 'HALF TONE' })[res].padEnd(10)}:${contrast}`;

/** The text of a message. */
export const msg = (id) => {
  const m = MESSAGES[id];
  if (!m) throw new Error(`no LCD message ${id}`);
  return m.text;
};

/** The diagnostic items in the manual's order, with their direct keys (A-E) [S p.2-2/pdf17]. */
export const DIAG_ITEMS = Object.freeze([
  ['D_SOFT', null], ['D_ROMRAM', 'A'], ['D_AGING', null], ['D_PANEL', null], ['D_PATTERN', 'B'], ['D_SIGNAL', 'C'],
  ['D_MEMCLR', null], ['D_SHADING', null], ['D_BLACK', 'D'], ['D_FEEDER', 'E'], ['D_ESEND', null], ['D_ERECV', null],
  ['D_CUTTER', null], ['D_COUNTRY', null],
]);

/** The signal send mode's sequence, one a START [S p.2-3/pdf18]. */
export const SIGNAL_SEND = Object.freeze(['NO SIGNAL', '9600BPS', '7200BPS', '4800BPS', '2400BPS', '300BPS (FLAG)',
  '2100HZ (CED)', '1100HZ (CNG)', 'PSEUDO RING', 'END']);

// ---- error codes ----------------------------------------------------------------------------------------------------

/**
 * The communication error code table, verbatim [S p.2-19/pdf34]: for each code, the final signal received and the
 * error condition. TX when the FO-70 sent, RX when it received. (The table heads both "Error Condition (Receiver
 * side)".) Codes 8 and 13 concern error retransmission, which the machine does not do (no ECM): they never arise here.
 */
export const COMM_CODES = Object.freeze({
  TX: Object.freeze({
    0: ['Incomplete signal frame', 'Cannot recognize bit stream after flag'],
    1: ['NSF, DIS', 'Cannot recognize DCS signal by echo etc. Cannot recognize NSS signal (FIF code etc)'],
    2: ['CFR', 'Disconnects line during reception (carrier missing etc)'],
    3: ['FTT', 'Disconnects line by fall back'],
    4: ['MCF', 'Disconnects line during reception of multi page. Cannot recognize NSS, DCS signal in the case of mode change'],
    5: ['PIP or PIN', 'The line is hung up without replying to telephone request from the receiving party.'],
    6: ['RTN or RTP', 'Cannot recognize NSS, DCS signal after transmit RTN or RTP signal.'],
    7: ['No signal or DCN', 'No response in receiver side or DCN signal received (transmitter side)'],
    8: ['-', 'Owing to error in some page the error could not be corrected although the specified number of error retransmissions were attempted.'],
    11: ['-', 'Error occurred after or while reception by the remote (receiving) machine was revealed to be impossible.'],
    12: ['-', 'Error occurred just after fallback.'],
    13: ['-', 'Error occurred after a response to retransmission end command was received.'],
  }),
  RX: Object.freeze({
    0: ['Incomplete signal frame', 'Cannot recognize bit stream after flag'],
    1: ['NSS, DCS', 'Cannot recognize CFR or FTT signal. Disconnects line during transmission (line error)'],
    2: ['NSC, DTC', 'Cannot recognize NSS signal (FIF code etc)'],
    3: ['EOP', 'Cannot recognize MCF, PIP, PIN, RTN, RTP signal'],
    4: ['EOM', 'Cannot recognize MCF, PIP, PIN, RTN, RTP signal in the case of mode change'],
    5: ['MPS', 'The line is hung up without replying to communication request.'],
    6: ['PR1-Q', 'Cannot recognize PIP, PIN signal in the case of TALK request'],
    7: ['No signal or DCN', 'No response in transmitter (cannot recognize DIS signal) or DCN signal received (receiver side)'],
    8: ['-', 'Error occurred upon completion of reception of all pages.'],
    9: ['-', 'Error occurred when mode was changed or Transmission/Reception switching was performed.'],
    10: ['-', 'Error occurred during partial page or physical page reception.'],
    11: ['-', 'Error occurred after or during inquiry from the remote (transmitting) machine as to whether reception is possible or not.'],
    12: ['-', 'Error occurred during or just after fallback.'],
    13: ['-', 'Error occurred after the retransmission end command was received.'],
  }),
});

/**
 * The code for a failed call, by the table's rule: the side ('TX' the FO-70 sent; 'RX' it received, a poll included),
 * the T.30 station's hangup reason and the last frame it heard (`lastRx`; 'BAD' for frames it could not read). The
 * transaction report prints the codes 0 to 7 as COM.E-0 to COM.E-7 [OM p.51], so the rule keeps to them: a call the
 * remote refused for capability (the table's 11) is filed under its final signal, DIS (1). Null for a call that did
 * not fail.
 */
export function commCode(side, { reason, lastRx = null } = {}) {
  if (reason === 'complete') return null;
  const f = lastRx;
  if (f === 'BAD') return 0;
  if (side === 'TX') {
    if (f === 'NSF' || f === 'DIS' || f === 'CSI') return 1;
    if (f === 'CFR') return 2;
    if (f === 'FTT') return 3;
    if (f === 'MCF') return 4;
    if (f === 'PIP' || f === 'PIN') return 5;
    if (f === 'RTN' || f === 'RTP') return 6;
    return 7;
  }
  if (f === 'NSS' || f === 'DCS' || f === 'TSI') return 1;
  if (f === 'NSC' || f === 'DTC' || f === 'CIG') return 2;
  if (f === 'EOP') return 3;
  if (f === 'EOM') return 4;
  if (f === 'MPS') return 5;
  if (f && f.startsWith('PRI-')) return 6;
  return 7;
}

/**
 * What a call or a job ended with, kept in the journal as `result`. `note` is the transaction report's NOTE: OK,
 * P.FAIL, JAM, NO PAPER, COM.E-0 to COM.E-7, CANCEL [OM p.51]; 'COM' prints COM.E- and the entry's `code` (commCode).
 * `lcd` is the message shown. The report has no NOTE for a busy line or a refused junk fax: those are ours [A].
 */
export const ERRORS = Object.freeze({
  OK:          { note: 'OK',       lcd: null },
  NO_LINE:     { note: 'COM',      lcd: 'LINE_ERROR' },
  BUSY:        { note: 'BUSY',     lcd: 'LINE_BUSY' },              // [A]
  NO_ANSWER:   { note: 'COM',      lcd: 'LINE_BUSY' },              // LINE BUSY: "busy or the receiving fax machine doesn't answer" [OM p.90]
  TRAINING:    { note: 'COM',      lcd: 'LINE_ERROR' },
  NO_RESPONSE: { note: 'COM',      lcd: 'LINE_ERROR' },
  PAGE_REJ:    { note: 'COM',      lcd: 'LINE_ERROR' },
  REMOTE_DCN:  { note: 'COM',      lcd: 'LINE_ERROR' },
  INCOMPAT:    { note: 'CANCEL',   lcd: 'LINE_ERROR' },             // "the other machine requested transmission using a function which your fax does not have" [OM p.51]
  LINE_DROP:   { note: 'COM',      lcd: 'LINE_ERROR' },
  RX_TIMEOUT:  { note: 'COM',      lcd: 'LINE_ERROR' },
  STOPPED:     { note: 'CANCEL',   lcd: null },                     // STOP pressed [OM p.51]
  DOC_JAM:     { note: 'JAM',      lcd: 'DOC_JAMMED' },
  PAPER:       { note: 'NO PAPER', lcd: 'OUT_OF_PAPER' },
  PAPER_JAM:   { note: 'JAM',      lcd: 'PAPER_JAMMED' },
  COVER:       { note: 'JAM',      lcd: 'COVER_OPEN' },             // "Make sure the operation panel is shut securely" under JAM [OM p.51]
  CUTTER:      { note: 'JAM',      lcd: 'PAPER_JAMMED' },
  NO_POLL:     { note: 'CANCEL',   lcd: 'LINE_ERROR' },             // no document at the polled machine [OM p.51]
  BLOCKED:     { note: 'BLOCKED',  lcd: 'BLOCKED' },                // [A]
});

/** The NOTE a journal entry prints: OK, COM.E-n and the rest [OM p.51]. */
export function noteFor(entry) {
  const e = ERRORS[entry.result] ?? ERRORS.LINE_DROP;
  return e.note === 'COM' ? `COM.E-${entry.code ?? 7}` : e.note;
}

/** The result for a T.30 station's hangup reason (src/fax/t30/station.js). */
export function errorForHangup(reason) {
  switch (reason) {
    case 'complete': return 'OK';
    case 'T1': return 'NO_ANSWER';
    case 'T2': return 'RX_TIMEOUT';
    case 'training-failed': return 'TRAINING';
    case 'no-response': return 'NO_RESPONSE';
    case 'page-rejected': return 'PAGE_REJ';
    case 'remote-dcn': return 'REMOTE_DCN';
    case 'incompatible': return 'INCOMPAT';
    case 'aborted': return 'STOPPED';
    case 'nothing-to-poll': return 'NO_POLL';
    case 'nothing-to-send': return 'NO_POLL';
    default: return 'LINE_DROP';
  }
}
