import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOMER_COUNTRIES } from '../../src/domain/customerCountries.mjs';
import { CHINA_PROVINCE_LEVEL_REGIONS, CUSTOMER_REGIONS } from '../../src/domain/customerRegions.mjs';

test('customer country options contain the complete sovereign-state list plus Other', () => {
  assert.equal(CUSTOMER_COUNTRIES.length, 196);
  assert.equal(new Set(CUSTOMER_COUNTRIES).size, CUSTOMER_COUNTRIES.length);
  assert.equal(CUSTOMER_COUNTRIES[0], 'China');
  for (const country of ['Afghanistan', 'Brazil', 'Germany', 'South Africa', 'United States', 'Zimbabwe', 'Other']) {
    assert.ok(CUSTOMER_COUNTRIES.includes(country), `missing country ${country}`);
  }
});

test('customer region options contain all 34 China province-level regions', () => {
  assert.equal(CHINA_PROVINCE_LEVEL_REGIONS.length, 34);
  assert.equal(new Set(CHINA_PROVINCE_LEVEL_REGIONS).size, CHINA_PROVINCE_LEVEL_REGIONS.length);
  for (const region of ['Beijing', 'Shanghai', 'Guangdong', 'Inner Mongolia', 'Xinjiang', 'Hong Kong', 'Macau', 'Taiwan']) {
    assert.ok(CHINA_PROVINCE_LEVEL_REGIONS.includes(region), `missing region ${region}`);
    assert.ok(CUSTOMER_REGIONS.includes(region), `missing customer region ${region}`);
  }
});
