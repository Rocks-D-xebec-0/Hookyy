import { Before, Given, Then } from '@badeball/cypress-cucumber-preprocessor';

// Meant for @api scenarios only, but has no tag filter (see hook-auditor.config.yml)
Before(function () {
  cy.intercept('GET', '/api/**', { body: { results: [] } });
});

Given('I open the search page', () => {
  cy.visit('https://example.cypress.io');
});

Then('I see the page', () => {
  cy.get('body').should('be.visible');
});
