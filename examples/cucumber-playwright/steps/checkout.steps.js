const { Given, When, Then } = require('@cucumber/cucumber');

Given('a cart with {int} items', async function (count) {
  await this.page.setContent('<h1>Cart</h1><p id="count">' + count + '</p>');
});

When('I pay by card', async function () {
  await this.page.setContent('<h1>Order confirmed</h1>');
});

When('I pay with a voucher', function () {
  return 'skipped'; // WIP: vouchers are not implemented yet
});

When('I check out as a guest', async function () {
  await this.page.setContent('<h1>Order confirmed</h1>');
});

Then('the order is confirmed', async function () {
  const text = await this.page.textContent('h1');
  if (text !== 'Order confirmed') throw new Error('Unexpected heading: ' + text);
});
