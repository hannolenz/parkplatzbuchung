import test from 'node:test';
import assert from 'node:assert/strict';
import { isoToParts, slotLabel, validateInput, parseStation, pickStation } from '../lib/parking-domain.mjs';
const input = { date: '2026-09-28', slot: 'morning', priorities: ['1183', '1181'], fallback: true };
const stations = [{ number: '1181', free: true }, { number: '1183', free: false }, { number: '1185', free: true }];
test('priority order beats page order; first free preferred station wins', () => {
  assert.equal(pickStation(stations, ['1185', '1181']).number, '1185');
  assert.equal(pickStation(stations, ['1183', '1181']).number, '1181');
});
test('fallback enabled, disabled, no free stations, empty list', () => {
  assert.equal(pickStation(stations, ['999'], true).number, '1181');
  assert.equal(pickStation(stations, ['999'], false), null);
  assert.equal(pickStation([{ number: '1', free: false }], [], true), null);
  assert.equal(pickStation([], [], true), null);
  assert.equal(pickStation(stations, [], false), null);
});
test('priorities are deduplicated preserving order; no input mutation', () => {
  const source = { ...input, priorities: ['1183', '1181', '1183'] };
  assert.deepEqual(validateInput(source).priorities, ['1183', '1181']);
  assert.equal(source.priorities.length, 3);
});
test('real calendar dates and leap years', () => {
  assert.deepEqual(isoToParts('2028-02-29'), { y: 2028, m: 2, d: 29 });
  for (const date of ['2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01extra', '', null, 20260101]) {
    assert.throws(() => isoToParts(date));
  }
});
test('only the two supported slots are accepted', () => {
  assert.equal(slotLabel('morning'), '07:00 Uhr bis 12:30 Uhr');
  assert.equal(slotLabel('afternoon'), '13:00 Uhr bis 15:00 Uhr');
  for (const slot of ['evening', '', null, undefined, 1]) assert.throws(() => slotLabel(slot));
});
test('invalid station numbers and priority types rejected', () => {
  for (const priorities of ['1181', null, [1181], ['0'], ['01'], ['-1'], ['1.5'], ['1e3'], ['1<script>'], ['12345678901'], Array(101).fill('1')]) {
    assert.throws(() => validateInput({ ...input, priorities }));
  }
});
test('booleans, confirmation, expected station and object shape are strict', () => {
  for (const fallback of ['true', 'false', 0, 1, null, undefined]) assert.throws(() => validateInput({ ...input, fallback }));
  for (const confirm of [undefined, false, 'true', 1]) assert.throws(() => validateInput({ ...input, confirm, expectedStation: '1181' }, true));
  assert.throws(() => validateInput({ ...input, confirm: true }, true));
  assert.throws(() => validateInput({ ...input, extra: 'x' }));
  for (const value of [null, [], 'x']) assert.throws(() => validateInput(value));
  assert.equal(validateInput({ ...input, confirm: true, expectedStation: '1181' }, true).expectedStation, '1181');
});
test('negative or ambiguous free text never counts as free', () => {
  assert.equal(parseStation('1181 - frei').free, true);
  for (const label of ['1181 - nicht frei', '1181 - reserviert', '1181 - frei ab morgen']) assert.equal(parseStation(label).free, false);
  assert.equal(parseStation('Bitte auswählen'), null);
});
