@checkout
Feature: Checkout

  @db
  Scenario: Pay with card
    Given a cart with 2 items
    When I pay by card
    Then the order is confirmed

  @wip
  Scenario: Pay with voucher
    Given a cart with 2 items
    When I pay with a voucher
    Then the order is confirmed

  @smoke
  Scenario: Guest checkout
    Given a cart with 2 items
    When I check out as a guest
    Then the order is confirmed
