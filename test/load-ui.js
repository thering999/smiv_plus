// โหลด docs/ui.js เข้า Node ผ่าน vm sandbox — ต้องโหลด app.js ก่อน (ให้ window.smivEngine มีค่า)
// แล้ว stub document/localStorage/Chart/fetch ขั้นต่ำที่สุดเท่าที่ ui.js ต้องใช้
// หมายเหตุ: stub แยกตาม selector/id (ไม่ใช้ object เดียวร่วมกัน) เพื่อให้เทสต์ตรวจสถานะปุ่ม/การซ่อน element ได้จริง
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    _values() { return [...set]; },
  };
}

function makeElement(key) {
  return {
    _key: key,
    addEventListener() {}, removeEventListener() {},
    classList: makeClassList(),
    style: {}, dataset: {},
    hidden: true, disabled: false, textContent: '', innerHTML: '', value: '', title: '', className: '',
    setAttribute() {}, getAttribute() { return null; },
    closest(sel) { return makeElement(`${key} <${sel}>`); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {}, remove() {}, click() {}, focus() {}, blur() {},
    scrollIntoView() {},
  };
}

function loadUi() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui.js'), 'utf8');

  const elements = new Map();
  function el(key) {
    if (!elements.has(key)) elements.set(key, makeElement(key));
    return elements.get(key);
  }

  const documentStub = {
    querySelector: sel => el(sel),
    querySelectorAll: () => [],
    getElementById: id => el('#' + id),
    addEventListener: () => {},
    createElement: tag => ({ ...makeElement('<' + tag + '>'), appendChild() {}, remove() {}, click() {} }),
    createTextNode: text => ({ _key: '#text', textContent: String(text) }),
    body: { classList: makeClassList(), appendChild() {} },
  };
  const localStorageStub = {
    _data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  // XLSX stub: จับ aoa (array-of-arrays) ที่ exportReportXlsx/exportIssuesXlsx ส่งเข้ามาจริง
  // เพื่อทดสอบว่าจำนวนคอลัมน์ของ header กับแต่ละแถวข้อมูลตรงกันเสมอ (บั๊กที่เคยเกิดจริงในโปรเจกต์นี้)
  const xlsxStub = {
    lastAoa: null,
    utils: {
      aoa_to_sheet(aoa) { xlsxStub.lastAoa = aoa; return {}; },
      book_new() { return {}; },
      book_append_sheet() {},
    },
    writeFile() {},
  };

  // Chart stub: ui.js เรียก new Chart(canvas, config) ตอน render — ให้เป็น no-op เพื่อเทสต์ render ได้
  function ChartStub() {}
  ChartStub.defaults = {};
  ChartStub.prototype.destroy = function () {};

  // fetch stub: เก็บว่าเรียก URL ไหนไปบ้าง (เทสต์ยืนยันว่า "ไม่ยิง network" ในเส้นทางที่ต้องห้าม)
  const fetchCalls = [];
  const fetchStub = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return { ok: false, status: 401, json: async () => ({ error: 'not stubbed' }) };
  };

  const windowStub = { addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    window: windowStub, document: documentStub, localStorage: localStorageStub, sessionStorage: localStorageStub,
    navigator: { serviceWorker: undefined }, location: { search: '', pathname: '/', origin: '' },
    console, Notification: undefined, URLSearchParams, history: { replaceState() {} },
    XLSX: xlsxStub, Chart: ChartStub, fetch: fetchStub, atob, btoa,
  };
  vm.createContext(sandbox);
  new vm.Script(appSrc, { filename: 'app.js' }).runInContext(sandbox);
  new vm.Script(uiSrc, { filename: 'ui.js' }).runInContext(sandbox);
  sandbox.fetchCalls = fetchCalls;
  sandbox.elements = elements;
  return sandbox;
}

module.exports = { loadUi };

