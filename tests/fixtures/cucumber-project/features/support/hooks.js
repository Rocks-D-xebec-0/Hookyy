const { Before, After } = require('@cucumber/cucumber');

// Fixture for hookyy tests: line numbers matter.

Before({ tags: '@db' }, async function () {
  await this.resetDatabase();
});




Before(async function () {
  await this.login();
});





After(async function () {
  await this.screenshot();
});







Before({ tags: '@wip' }, async function () {
  await this.prepareWip();
});







Before('@payments', function () {
  this.stubPayments();
});


