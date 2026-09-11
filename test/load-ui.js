// โหลด docs/ui.js เข้า Node ผ่าน vm sandbox — ต้องโหลด app.js ก่อน (ให้ window.smivEngine มีค่า)
// แล้ว stub document/localStorage ขั้นต่ำที่สุดเท่าที่ ui.js ต้องใช้ตอน "โหลดไฟล์" (ไม่ใช่ตอนเรียกฟังก์ชัน)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUi() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui.js'), 'utf8');

  const noopEl = { addEventListener() {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: {}, hidden: true, textContent: '', innerHTML: '', value: '' };
  const documentStub = {
    querySelector: () => noopEl,
    querySelectorAll: () => [],
    getElementById: () => noopEl,
    addEventListener: () => {},
    createElement: () => ({ ...noopEl, appendChild() {}, remove() {}, click() {} }),
    body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
  };
  const localStorageStub = {
    _data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  const windowStub = { addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    window: windowStub, document: documentStub, localStorage: localStorageStub, sessionStorage: localStorageStub,
    navigator: { serviceWorker: undefined }, location: { search: '', pathname: '/', origin: '' },
    console, Notification: undefined, URLSearchParams, history: { replaceState() {} },
  };
  vm.createContext(sandbox);
  new vm.Script(appSrc, { filename: 'app.js' }).runInContext(sandbox);
  new vm.Script(uiSrc, { filename: 'ui.js' }).runInContext(sandbox);
  return sandbox;
}

module.exports = { loadUi };
