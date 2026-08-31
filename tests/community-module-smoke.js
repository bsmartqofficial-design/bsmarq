const assert = require('assert');
const queries = require('../src/queries');
assert.ok(typeof queries.getCommunityModuleOverview === 'function', 'Community overview API missing');
assert.ok(typeof queries.createCommunityBeneficiary === 'function', 'Community beneficiary API missing');
assert.ok(typeof queries.normalizePhoneNumber === 'function', 'Phone normalization missing');
assert.strictEqual(queries.normalizePhoneNumber('0700 123 456'), '+256700123456');
assert.strictEqual(queries.normalizePhoneNumber('+256 700 123 456'), '+256700123456');
console.log('community smoke ok');
