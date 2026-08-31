const assert = require('assert');
const queries = require('../src/queries');
const { askGemini } = require('../src/ai');

(async () => {
  assert.ok(typeof queries.getCommunityModuleOverview === 'function', 'Community overview API missing');
  assert.ok(typeof queries.createCommunityBeneficiary === 'function', 'Community beneficiary API missing');
  assert.ok(typeof queries.normalizePhoneNumber === 'function', 'Phone normalization missing');
  assert.strictEqual(queries.normalizePhoneNumber('0700 123 456'), '+256700123456');
  assert.strictEqual(queries.normalizePhoneNumber('+256 700 123 456'), '+256700123456');

  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFetch = global.fetch;

  delete process.env.GEMINI_API_KEY;
  let response = await askGemini('How many people are waiting in queue?', {
    organization: { name: 'Test Org' },
    stats: { waiting: 12, serving: 3, completed: 18, avgWait: '15 min' },
    activeTickets: [
      { number: 'REG-001', status: 'Waiting' },
      { number: 'REG-002', status: 'Waiting' },
      { number: 'REG-003', status: 'Now serving' }
    ],
    services: [{ name: 'Registration', count: 12 }]
  });
  assert.match(response, /12|waiting/i, 'Local queue formula should answer without an external API');

  process.env.GEMINI_API_KEY = 'offline-test-key';
  global.fetch = async () => {
    throw new Error('network offline');
  };
  response = await askGemini('How many people are in line?', {
    organization: { name: 'Test Org' },
    stats: { waiting: 7, serving: 2, completed: 11, avgWait: '10 min' },
    activeTickets: [
      { number: 'REG-101', status: 'Waiting' },
      { number: 'REG-102', status: 'Now serving' }
    ],
    services: [{ name: 'Registration', count: 7 }]
  });
  assert.match(response, /7|waiting/i, 'Offline fallback should recover when network is unavailable');

  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalApiKey;
  global.fetch = originalFetch;
  console.log('community smoke ok');
})();
