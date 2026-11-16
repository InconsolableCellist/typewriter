// Every fixed text the FO-70's 16-character LCD shows, in one table, and the error codes printed on reports.
//
// mark: 'S'  the wording was quoted by a search summary of the Sharp FO-50 / FO-70 operation manual's "Messages and
//            Signals" section (manualsonline.com, sharp/f050_f070, book pages 95 and 96, found 2026-11-16).
//            Not read at source: research.md section 8's [S].
//       'A'  assumed: plausible Sharp wording of the period, ours until the manual is read (M0).
// Texts are at most 16 characters, in the LCD's character set (panel.js).

export const MESSAGES = Object.freeze({
  // Faults (the four the summaries quoted).
  CHECK_PAPER:     { text: 'CHECK PAPER',      mark: 'S', note: 'thermal paper jammed or not loaded properly; also used here for an empty roll and a cutter jam [A]' },
  COVER_OPEN:      { text: 'COVER OPEN',       mark: 'S', note: 'the operation panel is open' },
  DOC_JAMMED:      { text: 'DOCUMENT JAMMED',  mark: 'S', note: 'the original is jammed in the feeder' },
  LINE_ERROR:      { text: 'LINE ERROR',       mark: 'S', note: 'transmission or reception failed; STOP clears it' },
  // Standby.
  DOC_READY:       { text: 'DOCUMENT READY',   mark: 'A' },
  SET_CLOCK:       { text: 'SET DATE&TIME',    mark: 'A', note: 'shown in turn with the clock line after a cold start' },
  // Resolution (the key's four settings; the resolutions themselves are [S]).
  RES_STANDARD:    { text: 'STANDARD',         mark: 'A' },
  RES_FINE:        { text: 'FINE',             mark: 'A' },
  RES_SUPERFINE:   { text: 'SUPER FINE',       mark: 'A' },
  RES_HALFTONE:    { text: 'HALF TONE',        mark: 'A' },
  // Reception modes (the names FAX and TEL/FAX are [S]; the LCD form is ours).
  MODE_FAX:        { text: 'FAX MODE',         mark: 'A' },
  MODE_TEL:        { text: 'TEL MODE',         mark: 'A' },
  MODE_TELFAX:     { text: 'TEL/FAX MODE',     mark: 'A' },
  MODE_AM:         { text: 'A.M. MODE',        mark: 'A' },
  // Dialling and sending.
  ENTER_FAX_NO:    { text: 'ENTER FAX #',      mark: 'A' },
  SPEED_NO:        { text: 'SPEED # (01-35)',  mark: 'A' },
  NOT_STORED:      { text: 'NOT STORED',       mark: 'A' },
  DIALING:         { text: 'DIALING',          mark: 'A' },
  SENDING:         { text: 'SENDING',          mark: 'A' },
  POLLING:         { text: 'POLLING',          mark: 'A' },
  LINE_BUSY:       { text: 'LINE BUSY',        mark: 'A' },
  REDIAL_WAIT:     { text: 'REDIAL WAIT',      mark: 'A', note: 'followed by the minutes and seconds left' },
  TX_OK:           { text: 'TRANSMISSION OK',  mark: 'A' },
  RX_OK:           { text: 'RECEPTION OK',     mark: 'A' },
  // Receiving and the telephone.
  RECEIVING:       { text: 'RECEIVING',        mark: 'A' },
  INCOMING:        { text: 'INCOMING CALL',    mark: 'A' },
  PICK_UP:         { text: 'PICK UP HANDSET',  mark: 'A', note: 'TEL/FAX mode while the machine pseudo-rings a voice call' },
  TELEPHONE:       { text: 'TELEPHONE',        mark: 'A' },
  ON_HOOK_DIAL:    { text: 'ON-HOOK DIAL',     mark: 'A' },
  ON_HOLD:         { text: 'ON HOLD',          mark: 'A' },
  BLOCKED:         { text: 'RECEPT. BLOCKED',  mark: 'A' },
  // Copy and lists.
  COPYING:         { text: 'COPYING',          mark: 'A' },
  PRINTING:        { text: 'PRINTING',         mark: 'A' },
  // Volume.
  SPEAKER_VOL:     { text: 'SPEAKER:',         mark: 'A' },
  RINGER_VOL:      { text: 'RINGER:',          mark: 'A' },
  // FUNCTION menu (setup.js).
  M_DATE:          { text: '1:DATE&TIME SET',  mark: 'A' },
  M_ID:            { text: '2:FAX #/NAME SET', mark: 'A' },
  M_TEL:           { text: '3:TEL # SET',      mark: 'A' },
  M_OPTION:        { text: '4:OPTION SETTING', mark: 'A' },
  M_JUNK:          { text: '5:JUNK FAX # SET', mark: 'A' },
  M_LIST:          { text: '6:PRINT LIST',     mark: 'A' },
  OWN_NUMBER:      { text: 'OWN FAX NUMBER',   mark: 'A' },
  ENTER_NAME:      { text: 'ENTER NAME',       mark: 'A' },
  STORED:          { text: 'STORED',           mark: 'A' },
  O_RINGS:         { text: '# OF RINGS',       mark: 'A' },
  O_CONTRAST:      { text: 'PRINT CONTRAST',   mark: 'A' },
  O_PSEUDO:        { text: 'PSEUDO RING',      mark: 'A' },
  O_REPORT:        { text: 'TRANS. REPORT',    mark: 'A' },
  O_CALLER_ID:     { text: 'CALLER ID',        mark: 'A' },
  O_DISTINCT:      { text: 'DISTINCTIVE RING', mark: 'A' },
  O_BLOCKING:      { text: 'FAX BLOCKING',     mark: 'A' },
  O_HEADER:        { text: 'HEADER PRINT',     mark: 'A' },
  O_DIAL:          { text: 'DIAL MODE',        mark: 'A' },
  JUNK_NO:         { text: 'JUNK # (1-5)',     mark: 'A' },
  L_TEL:           { text: '1:TEL # LIST',     mark: 'A' },
  L_SETUP:         { text: '2:SETUP LIST',     mark: 'A' },
  L_ACTIVITY:      { text: '3:ACTIVITY REP.',  mark: 'A' },
  L_TRANS:         { text: '4:TRANS. REPORT',  mark: 'A' },
  L_HELP:          { text: '5:HELP LIST',      mark: 'A' },
});

/** The text of a message. */
export const msg = (id) => {
  const m = MESSAGES[id];
  if (!m) throw new Error(`no LCD message ${id}`);
  return m.text;
};

/**
 * Error codes, printed in the NOTE column of the transmission report and the activity report. The service manual's
 * error code table (page 31 [S]) is not read: every code here is ours [A]. `lcd` is the message shown.
 */
export const ERRORS = Object.freeze({
  OK:          { code: 'OK',   lcd: null,          text: 'COMPLETED' },
  NO_LINE:     { code: 'E-01', lcd: 'LINE_ERROR',  text: 'NO DIAL TONE / LINE NOT CONNECTED' },
  BUSY:        { code: 'E-02', lcd: 'LINE_BUSY',   text: 'BUSY (REDIALS USED)' },
  NO_ANSWER:   { code: 'E-03', lcd: 'LINE_ERROR',  text: 'NO ANSWER / NOT A FAX (T1)' },
  TRAINING:    { code: 'E-04', lcd: 'LINE_ERROR',  text: 'TRAINING FAILED' },
  NO_RESPONSE: { code: 'E-05', lcd: 'LINE_ERROR',  text: 'NO RESPONSE TO COMMAND' },
  PAGE_REJ:    { code: 'E-06', lcd: 'LINE_ERROR',  text: 'PAGE REJECTED (RTN)' },
  REMOTE_DCN:  { code: 'E-07', lcd: 'LINE_ERROR',  text: 'DISCONNECTED BY REMOTE' },
  INCOMPAT:    { code: 'E-08', lcd: 'LINE_ERROR',  text: 'REMOTE CANNOT RECEIVE' },
  LINE_DROP:   { code: 'E-09', lcd: 'LINE_ERROR',  text: 'LINE DISCONNECTED' },
  STOPPED:     { code: 'E-10', lcd: null,          text: 'STOP KEY PRESSED' },
  RX_TIMEOUT:  { code: 'E-11', lcd: 'LINE_ERROR',  text: 'NO SIGNAL FROM REMOTE (T2)' },
  DOC_JAM:     { code: 'E-12', lcd: 'DOC_JAMMED',  text: 'DOCUMENT JAMMED' },
  PAPER:       { code: 'E-13', lcd: 'CHECK_PAPER', text: 'RECORDING PAPER OUT OR JAMMED' },
  COVER:       { code: 'E-14', lcd: 'COVER_OPEN',  text: 'COVER OPEN' },
  CUTTER:      { code: 'E-15', lcd: 'CHECK_PAPER', text: 'CUTTER ERROR' },
  NO_POLL:     { code: 'E-16', lcd: 'LINE_ERROR',  text: 'NOTHING TO POLL' },
  BLOCKED:     { code: 'E-17', lcd: 'BLOCKED',     text: 'JUNK FAX BLOCKED' },
});

/** The error for a T.30 station's hangup reason (src/fax/t30/station.js). */
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
