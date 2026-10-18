const button = document.getElementById('add-to-cart');
const status = document.getElementById('cart-status');
let count = 0;
button.addEventListener('click', () => {
  count += 1;
  status.textContent = count === 1 ? '1 item in your cart.' : `${count} items in your cart.`;
});
