// The service soft switches SW-A1 to SW-K1: eight bits each, set in the diagnostic mode's soft switch mode and kept in
// the battery-backed memory. Transcribed from the Sharp FO-50/FO-70 service manual, chapter 2 [2] 5, "Soft switch
// description", p.2-5 to p.2-12 (pdf20-27), with the functions explained on p.2-13 to p.2-17 (pdf28-32). Every
// switch's name and initial setting is the manual's [S]; the bits marked OPTION there are the ones the user's OPTION
// SETTING also sets. "The default settings of the soft switches vary according to the destinations" (p.2-3): these
// are the table's.
//
// A switch is { id, bits: [8 initial bits, data No. 1 first], items: [[first bit, last bit, name, option?]] }.
// Multi-bit fields read as binary, data No. 1 the most significant of the field, as the manual's "binary input"
// examples show (SW-B1 No. 4-8 = 0 1 0 1 0 is 10 half-minutes, 5 minutes).

const sw = (id, bits, items) => Object.freeze({ id, bits: bits.split('').map(Number), items });

export const SOFT_SWITCHES = Object.freeze([
  sw('A1', '00000000', [[1, 1, 'Protect from echo'], [2, 2, 'Forced 4800bps reception'], [3, 3, 'Footer print'],
    [4, 4, 'Length limitation of copy/send/receive'], [5, 5, 'CSI transmission'],
    [6, 6, 'DIS receive acknowledgement during G3 transmission'], [7, 7, 'Non modulated carrier for V29 transmission mode']]),
  sw('A2', '00010000', [[1, 4, 'Modem speed'], [6, 6, 'H2 mode'], [7, 7, 'Communication error treatment in RTN sending mode'],
    [8, 8, 'CNG transmission']]),
  sw('A3', '00000000', [[1, 2, 'CED tone signal interval'], [3, 3, 'MR Coding']]),
  sw('A4', '01100000', [[1, 5, 'Signal Transmission level'], [6, 6, 'Protocol monitor(Error print)'], [7, 7, 'Protocol monitor'],
    [8, 8, 'Line monitor']]),
  sw('A5', '11000001', [[1, 2, 'Digital equalization setting(Reception)'], [3, 4, 'Digital equalization setting(Transmitter)'],
    [5, 6, 'Digital equalization setting(Reception for Caller ID)'], [7, 7, 'Error criterion'], [8, 8, 'Anti junk fax check']]),
  sw('A6', '11100100', [[1, 1, 'Auto gain control(MODEM)'], [2, 2, 'End Buzzer'], [3, 3, 'Disconnect the line when DIS is received in RX mode'],
    [4, 4, 'Equalizer freeze control(MODEM)'], [5, 5, 'Equalizer freeze control 7200 bps only'], [6, 6, 'CNG transmission in manual TX mode'],
    [7, 7, 'Initial compression scheme for sharp fax in TX mode'], [8, 8, 'Modem speed automatic down when RX level is under -40dBm']]),
  sw('A7', '01000000', [[1, 2, 'EOL detect timer']]),
  sw('B1', '10001010', [[1, 1, 'Hold key'], [2, 2, 'Auto dial fax transmission by REDIAL key'], [4, 8, 'Recall interval']]),
  sw('B2', '00100000', [[1, 4, 'Recall times'], [5, 5, 'Dial tone detection(Before auto dial)'], [7, 7, 'Busy tone detection(After auto dial)'],
    [8, 8, 'Busy tone detection pulse number(After auto dial)']]),
  sw('B3', '00000000', [[1, 2, 'Waiting time after dialing']]),
  sw('B4', '00111000', [[1, 1, 'Dial pausing(sec/pause)'], [2, 2, 'Dial mode', true], [3, 3, 'Pulse -> Tone change function by * key'],
    [4, 4, 'Dial pulse make/break ratio(%)'], [5, 6, 'Auto dial mode Delay timer of before line connect']]),
  sw('B5', '01100000', [[1, 3, 'Auto dial mode Delay timer of after line connect'], [4, 4, 'Fax signal detection after telephone mode dial']]),
  sw('B6', '01011000', [[1, 5, 'DTMF signal transmission level (Low frequency)']]),
  sw('B7', '00101000', [[1, 5, 'DTMF signal transmission level (High frequency)']]),
  sw('C1', '00000000', [[1, 2, 'Reading Slice(Binary)'], [3, 4, 'Reading Slice(Half tone)'], [5, 5, 'Line density selection'],
    [7, 7, 'MTF correction in half tone mode']]),
  sw('D1', '00100000', [[1, 4, 'Number of rings for auto receive', true], [5, 5, 'Automatic swiching manual to auto receive function'],
    [6, 7, 'CI detect frequency']]),
  sw('D2', '00000000', [[6, 6, 'Caller ID function']]),
  sw('D3', '01110000', [[1, 5, 'CI off detection timer']]),
  sw('D4', '10110000', [[1, 6, 'DTMF type Caller ID RX level']]),
  sw('E1', '01010110', [[1, 3, 'Pseudo ringing time at the TEL/FAX automatic switching mode'],
    [4, 4, 'Number of CNG signal detection at the TEL/FAX automatic switching mode'], [5, 5, 'CNG detect time at TEL/FAX mode'],
    [6, 6, 'Post answer tone(TEL/FAX mode)'], [7, 7, 'Type of post answer tone'], [8, 8, 'Pseudo ringer ON/OFF cycle']]),
  sw('E2', '10101100', [[1, 4, 'Pseudo ringer sound output level to the line'], [5, 8, 'Post answer tone transmission level']]),
  sw('E3', '00000000', [[1, 1, 'Disconnect the line when DTMF "#" is received during TEL/FAX automatic switching mode']]),
  sw('F1', '00010101', [[1, 2, 'DTMF detection time'], [3, 3, 'Protection of remote reception(5*) detection'],
    [4, 4, 'Remote reception with GE telephone'], [5, 8, 'Remote operation code figure by external TEL', true]]),
  sw('F2', '10101000', [[1, 1, 'CNG detection in STAND-BY mode', true], [2, 3, 'Number of CNG detect(AM mode)'],
    [4, 5, 'Number of CNG detect(STAND-BY mode)']]),
  sw('G1', '01000101', [[1, 4, 'Quiet detect time', true], [5, 8, 'Quiet detect start timing', true]]),
  sw('G2', '00000000', []),
  sw('G3', '01010000', [[1, 2, 'OGM detect timer'], [3, 4, 'Section time of quiet detection']]),
  sw('G4', '10110000', [[1, 6, 'Quiet detect level setting'], [7, 7, 'Fax switching when A.M. full', true]]),
  sw('H1', '10000010', [[1, 1, 'Busy tone continuous sound detect time'], [3, 3, 'Busy tone detect continuation sound detect'],
    [5, 5, 'Busy tone detect intermittent sound detect'], [6, 7, 'Busy tone detection pulse number']]),
  sw('H2', '00010000', [[1, 2, 'Busy tone detection ON/OFF time(Lower limit)'], [3, 4, 'Busy tone detection ON/OFF time(Upper limit)']]),
  ...['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8'].map((id) => sw(id, '00000000', [])),
  sw('J1', '00101000', [[1, 1, "Sender's phone number setting"], [3, 4, 'Ringer volume', true], [5, 6, 'Speaker volume', true],
    [7, 7, 'Polling key', true]]),
  sw('J2', '00000001', [[7, 7, 'Saving energy start timing'], [8, 8, 'Saving energy mode']]),
  sw('J3', '00000000', [[1, 3, 'Communication results printout (Transaction report)', true], [4, 4, 'Time format'], [5, 5, 'Date format']]),
  sw('K1', '00000000', [[1, 1, 'Entering diag mode by pressing SPEED key']]),
]);

/** Every switch's initial bits, { A1: [0,0,...], ... }: what a memory clear sets. */
export function defaultSoftSwitches() {
  return Object.fromEntries(SOFT_SWITCHES.map((s) => [s.id, s.bits.slice()]));
}

/** Read bits first..last (1-based, data No.) of switch `id` as binary, first the most significant. */
export function field(sws, id, first, last = first) {
  const b = sws?.[id] ?? SOFT_SWITCHES.find((s) => s.id === id).bits;
  let v = 0;
  for (let i = first; i <= last; i++) v = v * 2 + (b[i - 1] ? 1 : 0);
  return v;
}

/** Write value v into bits first..last of switch `id`. */
export function setField(sws, id, first, last, v) {
  const b = sws[id];
  for (let i = last; i >= first; i--) { b[i - 1] = v & 1; v >>= 1; }
}

/**
 * What the firmware reads from the switches, decoded by the manual's tables [S p.2-5 to 2-12]. Only the switches
 * the simulation acts on; the rest are kept, shown and printed.
 */
export function decode(sws) {
  const f = (id, a, b) => field(sws, id, a, b);
  const pick = (v, list) => list[v];
  return {
    // SW-A1
    footerPrint: f('A1', 3) === 1,
    lengthLimit: f('A1', 4) === 1 ? null : { copySendM: 0.6, receiveM: 1.5 },
    sendCsi: f('A1', 5) === 0,
    // SW-A2 No. 1-4: 0001 9600, 0011 7200, 0010 4800, 0000 2400 (V.29 / V.27ter)
    startRate: ({ 1: 9600, 3: 7200, 2: 4800, 0: 2400 })[f('A2', 1, 4)] ?? 9600,
    cngManualKeypad: f('A2', 8) === 0,
    // SW-A3 No. 1-2: CED to DIS gap, 11 1000 ms, 10 750 ms, 01 500 ms, 00 75 ms
    cedGapMs: pick(f('A3', 1, 2), [75, 500, 750, 1000]),
    mrCoding: f('A3', 3) === 0,
    txLevelDbm: -f('A4', 1, 5),
    antiJunk: f('A5', 8) === 1,
    endBuzzer: f('A6', 2) === 1,
    cngManualTx: f('A6', 6) === 1,
    eolTimerS: pick(f('A7', 1, 2), [5, 13, 20, 25]),
    holdKey: f('B1', 1) === 1,
    redialAutoSend: f('B1', 2) === 1,
    // Recall interval in half minutes; 0 is taken as half a minute (p.2-14).
    recallIntervalS: Math.max(1, f('B1', 4, 8)) * 30,
    recallTimes: f('B2', 1, 4),
    dialToneDetect: f('B2', 5) === 0,
    busyToneDetect: f('B2', 7) === 0,
    waitAfterDialS: pick(f('B3', 1, 2), [45, 55, 90, 140]),
    pauseS: f('B4', 1) === 1 ? 4 : 2,
    // SW-B4 No. 2: 1 tone, 0 pulse (table and description agree, p.2-6, p.2-14), initial 0; but the installation
    // chapter says the machine is set for tone dialling (p.1-5). The user's DIAL MODE option is what the firmware dials
    // with (setup.js); this is the switch's own reading.
    dialMode: f('B4', 2) === 1 ? 'TONE' : 'PULSE',
    makeRatio: f('B4', 4) === 1 ? 40 : 33,
    delayAfterConnectS: pick(f('B5', 1, 3), [1.7, 2.0, 2.5, 3.0, 3.6, 4.0, 5.5, 7.0]),
    dtmfLowDbm: -0.5 * f('B6', 1, 5), dtmfHighDbm: -0.5 * f('B7', 1, 5),
    copyFineDefault: true,                                  // SW-C1 No. 5: copy is fine unless set (p.2-15)
    txDefaultFine: f('C1', 5) === 1,
    // SW-D1 No. 1-4: rings to answer; 0 is taken as 1 (p.2-15).
    rings: Math.max(1, f('D1', 1, 4)),
    manualToAutoAfter5: f('D1', 5) === 1,
    callerId: f('D2', 6) === 1,
    ciOffMs: 50 * f('D3', 1, 5),
    pseudoRingS: pick(f('E1', 1, 3), [9, 15, 30, 60, 90, 120, 150, 180]),
    cngCountTelFax: f('E1', 4) === 1 ? 2 : 1,
    cngDetectTelFaxS: f('E1', 5) === 1 ? 3 : 5,
    postAnswerTone: f('E1', 6) === 0,
    postAnswerType: f('E1', 7) === 1 ? 'LA-SI-DO' : '800Hz',
    pseudoCycle: f('E1', 8) === 1 ? { onS: 1, offS: 4 } : { onS: 1, offS: 2 },
    remoteCode: Math.min(9, f('F1', 5, 8)),
    // SW-F2 No. 1: the table's columns say 1 = Yes; its description says 1 stops the detection (p.2-16). Read as the
    // table, since the initial 1 then keeps the standby CNG detection the A.M. mode needs.
    cngStandby: f('F2', 1) === 1,
    quietDetectS: f('G1', 1, 4), quietStartS: f('G1', 5, 8),
    ogmDetectMs: pick(f('G3', 1, 2), [0, 100, 200, 300]),
    quietSectionS: pick(f('G3', 3, 4), [30, 40, 50, 60]),
    amFullToFax: f('G4', 7) === 1,
    ringerVolume: pick(f('J1', 3, 4), [0, 1, 2, 3]),        // off, low, middle, high
    speakerVolume: Math.max(1, f('J1', 5, 6)),              // low (00 and 01), middle, high
    pollingKey: f('J1', 7) === 1,
    // SW-J3 No. 1-3: 000 error only, 001 send only, 010 always, 011 none
    report: pick(f('J3', 1, 3), ['ERROR', 'SEND', 'ALWAYS', 'NEVER', 'ERROR', 'ERROR', 'ERROR', 'ERROR']),
    clock12h: f('J3', 4) === 1,
    monthFirst: f('J3', 5) === 1,
  };
}

/** The soft switch display: 'SW-A1 = 00000000' [A: the manual's drawing reads "SFT SW-A1 = 0 0 0 ...", p.2-4]. */
export const swText = (id, bits) => `SW-${id} = ${bits.join('')}`;
