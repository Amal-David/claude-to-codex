import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function mount() {
  const handlers = new Map();
  const button = { textContent: 'Add to cart', addEventListener: (name, handler) => handlers.set(name, handler) };
  const status = { textContent: 'Your cart is empty.' };
  vm.runInNewContext(fs.readFileSync('button.js', 'utf8'), { document: { getElementById: id => ({ 'add-to-cart': button, 'cart-status': status })[id] } });
  return { button, status, handlers, click: () => handlers.get('click')() };
}
test('semantic button keeps native keyboard activation and cannot submit a form', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<button\b[^>]*type="button"[^>]*>Add to cart<\/button>/);
  assert.doesNotMatch(html, /<div\b[^>]*role="button"/);
});
test('cart changes have a polite live status announcement', () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /<p\b[^>]*role="status"[^>]*aria-live="polite"/);
});
test('first activation reports one item', () => {
  const app = mount(); app.click(); assert.equal(app.status.textContent, '1 item in your cart.');
});
test('repeated activations retain the count and pluralize correctly', () => {
  const app = mount(); for (let i = 0; i < 12; i++) app.click(); assert.equal(app.status.textContent, '12 items in your cart.');
});
test('initial state and button label stay intact', () => {
  const app = mount(); assert.equal(app.status.textContent, 'Your cart is empty.'); app.click(); assert.equal(app.button.textContent, 'Add to cart');
  assert.match(fs.readFileSync('index.html', 'utf8'), /Keep this existing introduction\./);
});
test('one native click handler avoids double-counting keyboard activation', () => {
  assert.deepEqual([...mount().handlers.keys()], ['click']);
});
test('keyboard users receive a visible offset focus ring', () => {
  assert.match(fs.readFileSync('button.css', 'utf8'), /button:focus-visible\s*\{[^}]*outline:\s*3px solid[^}]*outline-offset:\s*3px/s);
});
