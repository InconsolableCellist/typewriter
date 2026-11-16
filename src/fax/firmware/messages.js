// Every fixed text the FO-70's 16-digit LCD shows, in one table, and the error codes printed on reports.
//
// mark: 'S'  the wording as printed in the Sharp FO-50/FO-70 service manual (docs/fax/refs/sharp_fo70_service_manual.pdf),
//            `page` its page (the manual's own number, then the PDF's). The manual shows only the texts its procedures
//            pass through: power on, the diagnostic mode, the quick reference guide and the dial mode setting.
//       'O'  quoted by a search summary of the operation manual's "Messages and Signals" (research.md 8; that manual
//            is not in hand): its wording is likely but not read here.
//       'A'  ours: plausible Sharp wording of the period, until the operation manual is read.
// Texts are at most 16 characters, in the LCD's character set (panel.js).

const S = (text, page, note) => ({ text, mark: 'S', page, ...(note ? { note } : {}) });
const O = (text, note) => ({ text, mark: 'O', ...(note ? { note } : {}) });
const A = (text, note) => ({ text, mark: 'A', ...(note ? { note } : {}) });

export const MESSAGES = Object.freeze({
  // Power on (the power-on sequence, p.7-2/pdf80): the machine has no power switch (p.1-4).
  WAIT_MOMENT:     S('WAIT A MOMENT', 'p.7-2/pdf80', 'while the CPU and modem initialise; STOP held here offers the memory clear'),
  MEMORY_CLEAR_Q:  S('MEMORY CLEAR?', 'p.7-2/pdf80', 'START clears; nothing for 3 s returns to standby'),
  MEMORY_CLEARED:  S('MEMORY CLEARED', 'p.7-2/pdf80'),
  // Faults.
  CHECK_PAPER:     O('CHECK PAPER', 'thermal paper jammed or not loaded properly; also used here for an empty roll and a cutter jam [A]'),
  COVER_OPEN:      O('COVER OPEN', 'the operation panel is open (the door sensor, p.4-3)'),
  DOC_JAMMED:      S('DOCUMENT JAMMED', 'p.1-7/pdf12', 'the original does not feed; START tries again'),
  LINE_ERROR:      O('LINE ERROR', 'transmission or reception failed; STOP clears it'),
  // Standby. The clock line itself is built in main.js: "05-NOV 10:30" with an arrow to the reception mode's legend
  // printed by the LCD window (p.1-9/pdf14).
  DOC_READY:       A('DOCUMENT READY'),
  SET_CLOCK:       A('SET DATE & TIME', 'shown in turn with the clock line after a cold start'),
  // Resolution: the key's settings (the resolutions themselves, p.1-1).
  RES_STANDARD:    A('STANDARD'),
  RES_FINE:        A('FINE'),
  RES_SUPERFINE:   A('SUPER FINE'),
  RES_HALFTONE:    A('HALF TONE'),
  // Dialling and sending.
  ENTER_FAX_NO:    A('ENTER FAX #'),
  SPEED_NO:        A('SPEED # (06-40)', 'speed dial numbers 06-40, 01-05 on the rapid keys (p.1-9)'),
  NOT_STORED:      A('NOT STORED'),
  DIALING:         A('DIALING'),
  SENDING:         A('SENDING'),
  POLLING:         A('POLLING'),
  LINE_BUSY:       A('LINE BUSY'),
  REDIAL_WAIT:     A('REDIAL WAIT', 'followed by the minutes and seconds left'),
  TX_OK:           A('TRANSMISSION OK'),
  RX_OK:           A('RECEPTION OK'),
  // Receiving and the telephone.
  RECEIVING:       S('RECEIVING', 'p.1-9/pdf14', 'the TEL mode figure: handset, beeps, START, RECEIVING'),
  INCOMING:        A('INCOMING CALL'),
  PICK_UP:         A('PICK UP HANDSET', 'TEL/FAX mode while the machine pseudo-rings a voice call'),
  TELEPHONE:       A('TELEPHONE'),
  ON_HOOK_DIAL:    A('ON-HOOK DIAL'),
  ON_HOLD:         A('ON HOLD'),
  BLOCKED:         A('RECEPT. BLOCKED'),
  // Copy and lists.
  COPYING:         A('COPYING'),
  PRINTING:        A('PRINTING'),
  // Volume (one VOLUME key: the speaker's while SPEAKER is on, the ringer's otherwise, p.1-2).
  SPEAKER_VOL:     A('SPEAKER:'),
  RINGER_VOL:      A('RINGER:'),
  // The FUNCTION key's modes. FUNCTION 3 then # steps through the entry modes; FUNCTION 4 is the option setting,
  // where # (or *) steps through the options and the display alternates between a name and its prompt.
  M_ENTRY:         A('ENTRY MODE', 'what FUNCTION 3 shows before the first #: not in the service manual'),
  M_FAXTEL:        S('FAX/TEL # MODE', 'p.1-9/pdf14', 'FUNCTION 3 #: storing and clearing auto dial numbers'),
  M_OWN:           S('OWN NUMBER SET', 'p.1-9/pdf14', 'FUNCTION 3 # #: the own fax number and name'),
  M_DATE:          S('DATE & TIME SET', 'p.1-9/pdf14', 'FUNCTION 3 # # #'),
  M_JUNK:          A('JUNK FAX # MODE', 'a fourth entry mode of ours for the junk fax numbers (their list exists, p.2-3)'),
  M_OPTION:        S('OPTION SETTING', 'p.2-1/pdf16', 'FUNCTION 4'),
  M_LIST:          A('LIST MODE', 'FUNCTION 6: the reports and lists; not in the service manual'),
  PRESS_STAR_HASH: S('PRESS * OR #', 'p.2-1/pdf16', 'alternates with OPTION SETTING'),
  STORE_CLEAR:     A('1=STORE 2=CLEAR', 'FAX/TEL # MODE: "Press 1 to store a number or 2 to clear a number" (p.1-9)'),
  ENTER_NAME:      A('ENTER NAME'),
  STORED:          A('STORED'),
  CLEARED:         A('CLEARED'),
  // Options (OPTION SETTING). DIAL MODE and its prompts are the manual's; the others are the switches it marks OPTION
  // (rings SW-D1, volumes and the polling key SW-J1, the transaction report SW-J3, the remote code SW-F1, the A.M.
  // switches SW-G1 and G4, p.2-5 to 2-12), named by us.
  O_DIAL:          S('DIAL MODE', 'p.2-1/pdf16'),
  O_DIAL_CHOICE:   S('1=TONE, 2=PULSE', 'p.2-1/pdf16'),
  TONE_SELECTED:   S('TONE SELECTED', 'p.2-1/pdf16'),
  PULSE_SELECTED:  S('PULSE SELECTED', 'p.2-1/pdf16'),
  O_RINGS:         A('# OF RINGS'),
  O_RINGS_CHOICE:  A('ENTER 1-9'),
  O_REPORT:        A('TRANSACTION REP.'),
  O_REPORT_CHOICE: A('1=ERR 2=ON 3=OFF'),
  O_POLLING:       A('POLLING KEY'),
  O_YES_NO:        A('1=YES, 2=NO'),
  O_REMOTE:        A('REMOTE RX CODE'),
  O_REMOTE_CHOICE: A('ENTER 0-9'),
  O_AM_FULL:       A('A.M. FULL -> FAX'),
  O_CALLER_ID:     A('CALLER ID'),
  O_DISTINCT:      A('DISTINCTIVE RING'),
  O_BLOCKING:      A('JUNK FAX BLOCK'),
  O_CONTRAST:      A('CONTRAST'),
  O_CONTRAST_CHOICE: A('1=AUTO, 2=DARK', 'contrast "Automatic/Dark selectable" (p.1-1)'),
  SELECTED:        A('SELECTED', 'after a choice: "<choice> SELECTED", as TONE SELECTED'),
  // Lists (LIST MODE) [A].
  L_TEL:           A('TEL # LIST'),
  L_SETUP:         A('OPTION LIST'),
  L_ACTIVITY:      A('ACTIVITY REPORT'),
  L_TRANS:         A('TRANS. REPORT'),
  L_HELP:          A('HELP LIST'),
  // The diagnostic mode: FUNCTION 9 * 8 # 7 (p.2-2/pdf17). The ROM version for 2 s, then DIAG MODE; START, and the
  // items by * and # or their direct key. The item names are the manual's table; that the LCD shows them as written
  // is ours [A].
  ROM_VER:         S('ROM Ver. FZL0 *', 'p.2-2/pdf17', 'FZK0 on the FO-50'),
  DIAG_MODE:       S('DIAG MODE', 'p.2-2/pdf17'),
  D_SOFT:          S('SOFT SWITCH MODE', 'p.2-2/pdf17'),
  D_ROMRAM:        S('ROM & RAM CHECK', 'p.2-2/pdf17'),
  D_AGING:         S('AGING MODE', 'p.2-2/pdf17'),
  D_PANEL:         S('PANEL CHECK MODE', 'p.2-2/pdf17', 'printed "PANEL CKECK MODE" in the item table'),
  D_PATTERN:       S('CHECK PATTERN', 'p.2-2/pdf17'),
  D_SIGNAL:        S('SIGNAL SEND MODE', 'p.2-2/pdf17'),
  D_MEMCLR:        S('MEMORY CLEAR', 'p.2-2/pdf17'),
  D_SHADING:       S('SHADING MODE', 'p.2-2/pdf17'),
  D_BLACK:         S('ALL BLACK PRINT', 'p.2-2/pdf17'),
  D_FEEDER:        S('AUTO FEEDER MODE', 'p.2-2/pdf17'),
  D_ESEND:         S('ENTRY DATA SEND', 'p.2-2/pdf17'),
  D_ERECV:         S('ENTRY DATA RECEIVE', 'p.2-2/pdf17', 'eighteen letters: the LCD shows its first sixteen'),
  D_CUTTER:        S('CUTTER AGING', 'p.2-2/pdf17'),
  D_COUNTRY:       S('COUNTRY SELECT', 'p.2-2/pdf17'),
});

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
 * The code for a failed call, by the table's rule: the side (TX: the FO-70 sent or polled... see below), the T.30
 * station's hangup reason, the last frame it heard (`lastRx`, 'BAD' for frames it could not read) and whether it fell
 * back. A poll is a reception (the FO-70 receives the pages). Returns null for a call that did not fail.
 */
export function commCode(side, { reason, lastRx = null, fellBack = false, pagesReceived = 0 } = {}) {
  if (reason === 'complete') return null;
  const f = lastRx;
  if (f === 'BAD') return 0;
  if (side === 'TX') {
    if (reason === 'incompatible') return 11;
    if (f == null || f === 'DCN') return 7;
    if (f === 'NSF' || f === 'DIS' || f === 'CSI') return 1;
    if (f === 'CFR') return fellBack ? 12 : 2;
    if (f === 'FTT') return reason === 'training-failed' ? 3 : 12;
    if (f === 'MCF') return 4;
    if (f === 'PIP' || f === 'PIN') return 5;
    if (f === 'RTN' || f === 'RTP') return 6;
    return 7;
  }
  if (f == null || f === 'DCN') return 7;
  if (f === 'NSS' || f === 'DCS' || f === 'TSI') return pagesReceived > 0 ? 9 : 1;
  if (f === 'NSC' || f === 'DTC' || f === 'CIG') return 2;
  if (f === 'EOP' || f === 'PRI-EOP') return f === 'EOP' ? 3 : 6;
  if (f === 'EOM' || f === 'PRI-EOM') return f === 'EOM' ? 4 : 6;
  if (f === 'MPS' || f === 'PRI-MPS') return f === 'MPS' ? 5 : 6;
  if (f === 'CRP') return 10;
  return 7;
}

/**
 * What a call or a job ended with, kept in the journal as `result`. A communication error (`comm`) is printed with
 * its code from the table above, kept with the entry as `code`; the others are the machine's own conditions, which the
 * service manual's table does not cover: their report words are ours [A] until the operation manual is read. `lcd` is
 * the message shown.
 */
export const ERRORS = Object.freeze({
  OK:          { comm: false, lcd: null,          text: 'OK' },
  NO_LINE:     { comm: false, lcd: 'LINE_ERROR',  text: 'NO LINE' },
  BUSY:        { comm: false, lcd: 'LINE_BUSY',   text: 'BUSY' },
  NO_ANSWER:   { comm: true,  lcd: 'LINE_ERROR',  text: 'NO ANSWER' },
  TRAINING:    { comm: true,  lcd: 'LINE_ERROR',  text: 'TRAINING FAILED' },
  NO_RESPONSE: { comm: true,  lcd: 'LINE_ERROR',  text: 'NO RESPONSE' },
  PAGE_REJ:    { comm: true,  lcd: 'LINE_ERROR',  text: 'PAGE REJECTED' },
  REMOTE_DCN:  { comm: true,  lcd: 'LINE_ERROR',  text: 'DISCONNECTED' },
  INCOMPAT:    { comm: true,  lcd: 'LINE_ERROR',  text: 'REMOTE CANNOT RECEIVE' },
  LINE_DROP:   { comm: true,  lcd: 'LINE_ERROR',  text: 'LINE DISCONNECTED' },
  RX_TIMEOUT:  { comm: true,  lcd: 'LINE_ERROR',  text: 'NO SIGNAL' },
  STOPPED:     { comm: false, lcd: null,          text: 'STOP KEY' },
  DOC_JAM:     { comm: false, lcd: 'DOC_JAMMED',  text: 'DOCUMENT JAMMED' },
  PAPER:       { comm: false, lcd: 'CHECK_PAPER', text: 'PAPER OUT/JAMMED' },
  COVER:       { comm: false, lcd: 'COVER_OPEN',  text: 'COVER OPEN' },
  CUTTER:      { comm: false, lcd: 'CHECK_PAPER', text: 'CUTTER ERROR' },
  NO_POLL:     { comm: true,  lcd: 'LINE_ERROR',  text: 'NOTHING TO POLL' },
  BLOCKED:     { comm: false, lcd: 'BLOCKED',     text: 'JUNK FAX BLOCKED' },
});

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
